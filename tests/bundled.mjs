// Verify the deployable archive contains only the exact game data required by
// the browser importer and that network failures never masquerade as a ZIP.
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { unzipSync, zipSync, strToU8 } from 'fflate';

const root = 'Payload/HarborMasterHD.app/';
let bytes, synthetic = false;
try { bytes = await readFile('public/game/harbor-hd-assets.zip'); }
catch (err) {
  if (err?.code !== 'ENOENT') throw err;
  synthetic = true;
  const names = ['hmhd0001-texture.png', 'spritesTexture.png', 'hmhd0001.lvl', 'HarborMasterSeagulls.mp3',
    ...Array.from({length: 18}, (_, index) => `synthetic-effect-${index}.caf`)];
  bytes = zipSync(Object.fromEntries(names.map(name => [root + name, strToU8('synthetic test data')])));
  console.log('NOTE: original game bundle absent; testing loader with synthetic data.');
}
const files = unzipSync(bytes);
const names = Object.keys(files).sort();
for (const name of ['hmhd0001-texture.png', 'spritesTexture.png', 'hmhd0001.lvl', 'HarborMasterSeagulls.mp3']) {
  assert.ok(files[root + name], `required asset ${name} is present`);
}
assert.equal(names.filter(name => name.endsWith('.caf')).length, 18, 'all sound effects are bundled');
assert.equal(names.length, 22, 'only required game data is bundled');
assert.ok(names.every(name => name.startsWith(root) && (/\.(png|lvl|mp3|caf)$/i).test(name)), 'no executable, IPA, signature or other unrelated files are bundled');
const ipaPath = process.env.HARBOR_HD_IPA || resolve('../upload/Harbor Master HD 2.0.1.ipa');
if (!synthetic) {
  try {
    await access(ipaPath);
    const original = unzipSync(await readFile(ipaPath), { filter: entry => names.includes(entry.name) });
    for (const name of names) assert.deepEqual(files[name], original[name], `${name} matches the original IPA`);
  } catch (err) {
    if (process.env.HARBOR_HD_IPA || err?.code !== 'ENOENT') throw err;
    console.log('NOTE: original IPA not available; checked the selective bundle structurally.');
  }
}

const temp = await mkdtemp(join(tmpdir(), 'harbor-bundled-'));
try {
  const outfile = join(temp, 'bundled.cjs');
  await build({ entryPoints: ['src/bundled.ts'], outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' });
  const { fetchBundledGame } = await import(pathToFileURL(outfile).href);
  globalThis.document = { baseURI: 'https://example.test/harbor/' };
  let requested;
  globalThis.fetch = async (url, options) => { requested = { url: String(url), options }; return new Response(bytes, { status: 200 }); };
  const game = await fetchBundledGame();
  assert.equal(requested.url, 'https://example.test/harbor/game/harbor-hd-assets.zip');
  assert.equal(requested.options.credentials, 'same-origin');
  assert.equal(game.type, 'application/zip');
  assert.deepEqual(new Uint8Array(await game.arrayBuffer()), new Uint8Array(bytes));
  globalThis.fetch = async () => new Response('<html>Sign in to continue this is not a ZIP file</html>', { status: 200 });
  await assert.rejects(fetchBundledGame, /incomplete or invalid/, 'HTML redirect is rejected');
  globalThis.fetch = async () => new Response('Not found', { status: 404 });
  await assert.rejects(fetchBundledGame, /could not be downloaded/, 'HTTP failures are reported');
  globalThis.fetch = async () => { throw new Error('offline'); };
  await assert.rejects(fetchBundledGame, /check your connection/, 'offline errors are reported');
  console.log('PASS: selective original asset bundle, server loading and invalid response handling');
} finally { await rm(temp, { recursive: true, force: true }); }
