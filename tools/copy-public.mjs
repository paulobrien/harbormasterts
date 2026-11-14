import { cp } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Copy the app shell, never the separately staged game bundle. */
export async function copyPublic(root = process.cwd()) {
  const source = resolve(root, 'public');
  const destination = resolve(root, 'dist');
  await cp(source, destination, {
    recursive: true,
    filter(path) {
      return relative(source, path).split(sep)[0].toLowerCase() !== 'game';
    },
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await copyPublic();
}
