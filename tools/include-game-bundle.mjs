import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateBundle } from './stage-assets.mjs';

/** Opt-in: add only a validated staged bundle to a completed shell build. */
export async function includeGameBundle(root = process.cwd()) {
  const bytes = await readFile(resolve(root, 'public/game/harbor-hd-assets.zip'));
  validateBundle(bytes);
  const directory = resolve(root, 'dist/game');
  const output = resolve(directory, 'harbor-hd-assets.zip');
  const temporary = `${output}.tmp`;
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(temporary, bytes);
    await rename(temporary, output);
  } finally {
    await rm(temporary, { force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await includeGameBundle();
}
