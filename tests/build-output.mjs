import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { copyPublic } from '../tools/copy-public.mjs';
import { includeGameBundle } from '../tools/include-game-bundle.mjs';

const root = await mkdtemp(join(tmpdir(), 'harbor-build-output-'));
try {
  await mkdir(join(root, 'public', 'game'), { recursive: true });
  await writeFile(join(root, 'index.html'), '<script type="module" src="/main.js"></script>');
  await writeFile(join(root, 'main.js'), 'document.body.textContent = "test";');
  await writeFile(join(root, 'public', 'icon.svg'), '<svg/>');
  const prefix = 'Payload/HarborMasterHD.app/';
  const files = ['hmhd0001-texture.png', 'spritesTexture.png', 'hmhd0001.lvl', 'HarborMasterSeagulls.mp3', 'sound.caf'];
  const bundle = zipSync(Object.fromEntries(files.map(name => [prefix + name, strToU8('synthetic')])));
  await writeFile(join(root, 'public', 'game', 'harbor-hd-assets.zip'), bundle);
  const vite = resolve('node_modules/vite/bin/vite.js');
  const config = resolve('vite.config.ts');
  const build = async () => {
    const result = spawnSync(process.execPath, [vite, 'build', root, '--config', config], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    await copyPublic(root);
  };
  await build();
  assert.equal(await readFile(join(root, 'dist', 'icon.svg'), 'utf8'), '<svg/>');
  await assert.rejects(access(join(root, 'dist', 'game', 'harbor-hd-assets.zip')), { code: 'ENOENT' }, 'a normal build excludes staged game files');
  await includeGameBundle(root);
  assert.deepEqual(new Uint8Array(await readFile(join(root, 'dist', 'game', 'harbor-hd-assets.zip'))), bundle, 'the playable build includes the validated bundle');
  await build();
  await assert.rejects(access(join(root, 'dist', 'game', 'harbor-hd-assets.zip')), { code: 'ENOENT' }, 'a later normal build clears a previous playable bundle');
  await writeFile(join(root, 'public', 'game', 'harbor-hd-assets.zip'), 'invalid');
  await assert.rejects(includeGameBundle(root), /empty|valid ZIP/);
  await assert.rejects(access(join(root, 'dist', 'game', 'harbor-hd-assets.zip')), { code: 'ENOENT' }, 'invalid assets are not included');
  console.log('PASS: source-only builds exclude game assets and playable builds opt in to a validated bundle');
} finally {
  await rm(root, { recursive: true, force: true });
}
