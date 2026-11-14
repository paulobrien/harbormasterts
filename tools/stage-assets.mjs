/** Stage the game-data bundle from an owned IPA or an authorized external URL.
 * No URL, token, or asset bytes are written to the repository by this script.
 */
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { unzipSync } from 'fflate';

const ROOT = 'Payload/HarborMasterHD.app/';
const REQUIRED = ['hmhd0001-texture.png', 'spritesTexture.png', 'hmhd0001.lvl', 'HarborMasterSeagulls.mp3'];
const MAX_BYTES = 30 * 1024 * 1024;

export function validateBundle(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 22 || bytes.byteLength > MAX_BYTES) throw new Error('Game asset bundle is empty or too large.');
  let entries;
  try { entries = unzipSync(bytes); } catch { throw new Error('Game asset bundle is not a valid ZIP.'); }
  const names = Object.keys(entries);
  if (!REQUIRED.every(name => entries[ROOT + name]?.byteLength > 0)) throw new Error('Game asset bundle is missing required map, sprite, level, or music data.');
  const effects = names.filter(name => name.startsWith(ROOT) && /\.caf$/i.test(name));
  if (!effects.length) throw new Error('Game asset bundle contains no sound effects.');
  if (names.some(name => !name.startsWith(ROOT) || name.slice(ROOT.length).includes('/') || !/\.(png|lvl|mp3|caf)$/i.test(name))) {
    throw new Error('Game asset bundle contains an unexpected file.');
  }
  return { entries: names.length, effects: effects.length };
}

export async function stageAssets({env = process.env, root = process.cwd(), fetchFn = globalThis.fetch} = {}) {
  const sourceUrl = env.HARBOR_ASSET_BUNDLE_URL?.trim();
  const ipaPath = env.HARBOR_HD_IPA?.trim();
  if (sourceUrl && ipaPath) throw new Error('Set only one of HARBOR_ASSET_BUNDLE_URL and HARBOR_HD_IPA.');
  const output = resolve(root, 'public/game/harbor-hd-assets.zip');
  if (sourceUrl) {
    let url;
    try { url = new URL(sourceUrl); } catch { throw new Error('HARBOR_ASSET_BUNDLE_URL is not a valid URL.'); }
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname))) {
      throw new Error('The asset URL must use HTTPS (HTTP is allowed only for localhost).');
    }
    const headers = env.HARBOR_ASSET_BUNDLE_TOKEN ? {authorization: `Bearer ${env.HARBOR_ASSET_BUNDLE_TOKEN}`} : {};
    let response;
    try { response = await fetchFn(url, {headers, redirect: 'error'}); } catch { throw new Error('Could not download the game asset bundle.'); }
    if (!response.ok) throw new Error(`Game asset bundle request failed (HTTP ${response.status}).`);
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > MAX_BYTES) throw new Error('Game asset bundle is too large.');
    const bytes = new Uint8Array(await response.arrayBuffer());
    validateBundle(bytes);
    await mkdir(dirname(output), {recursive: true});
    const temporary = `${output}.tmp`;
    try { await writeFile(temporary, bytes, {mode: 0o600}); await rename(temporary, output); }
    finally { await rm(temporary, {force: true}); }
    return {source: 'url', output};
  }
  if (ipaPath) {
    const script = resolve(root, 'tools/build-game-bundle.py');
    const python = env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
    const result = spawnSync(python, [script, ipaPath], {encoding: 'utf8', stdio: 'pipe'});
    if (result.status !== 0) throw new Error('Could not generate the game bundle from the supplied IPA. Check the path and Python installation.');
    validateBundle(new Uint8Array(await readFile(output)));
    return {source: 'ipa', output};
  }
  try { validateBundle(new Uint8Array(await readFile(output))); }
  catch { throw new Error('No valid game bundle found. Set HARBOR_HD_IPA or HARBOR_ASSET_BUNDLE_URL, or generate public/game/harbor-hd-assets.zip first.'); }
  return {source: 'existing', output};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { const result = await stageAssets(); console.log(`Game assets staged (${result.source}).`); }
  catch (error) { console.error(error instanceof Error ? error.message : 'Could not stage game assets.'); process.exitCode = 1; }
}
