import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { versionShell } from '../tools/version-shell.mjs';

const root = await mkdtemp(join(tmpdir(), 'harbor-shell-version-'));
const worker = "const CACHE = 'harbor-master-shell-v5-__SHELL_VERSION__';";
try {
  await mkdir(join(root, 'assets'));
  await mkdir(join(root, 'game'));
  for (const file of ['index.html', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png']) {
    await writeFile(join(root, file), file);
  }
  await writeFile(join(root, 'assets', 'main.js'), 'first build');
  await writeFile(join(root, 'game', 'private.zip'), 'not part of the app shell');
  await writeFile(join(root, 'sw.js'), worker);
  const first = await versionShell(root);
  assert.match(await readFile(join(root, 'sw.js'), 'utf8'), new RegExp(first));
  await writeFile(join(root, 'sw.js'), worker);
  await writeFile(join(root, 'game', 'private.zip'), 'changed private bundle');
  assert.equal(await versionShell(root), first, 'game bundles do not change the shell version');
  await writeFile(join(root, 'sw.js'), worker);
  await writeFile(join(root, 'assets', 'main.js'), 'changed build');
  assert.notEqual(await versionShell(root), first, 'changed application code changes the worker version');
  await assert.rejects(versionShell(root), /placeholder is missing/, 'an already stamped worker is not silently stamped again');
  console.log('PASS: reproducible shell versions change with app assets and exclude game bundles');
} finally {
  await rm(root, { recursive: true, force: true });
}
