import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const placeholder = '__SHELL_VERSION__';
const shellFiles = [
  'index.html', 'manifest.webmanifest', 'icon.svg', 'icon-192.png',
  'icon-512.png', 'icon-maskable-512.png', 'sw.js',
];

async function assetFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? assetFiles(path) : [path];
  }));
  return files.flat();
}

/** Version only public app-shell files; private game bundles are excluded. */
export async function versionShell(directory) {
  const root = resolve(directory);
  const workerPath = join(root, 'sw.js');
  const worker = await readFile(workerPath, 'utf8');
  if (!worker.includes(placeholder)) throw new Error('Service worker version placeholder is missing');
  const paths = [...shellFiles, ...(await assetFiles(join(root, 'assets')))
    .map(path => relative(root, path).replaceAll('\\', '/'))].sort();
  const hash = createHash('sha256');
  for (const path of paths) {
    const content = await readFile(join(root, path));
    hash.update(path).update('\0');
    hash.update(String(content.length)).update('\0').update(content);
  }
  const version = hash.digest('hex').slice(0, 16);
  await writeFile(workerPath, worker.replaceAll(placeholder, version));
  return version;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await versionShell('dist');
}
