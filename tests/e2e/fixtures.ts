import { readFileSync } from 'node:fs';
import { strToU8, zipSync } from 'fflate';

// The fixture is intentionally synthetic. It contains project-owned artwork,
// a minimal level, and no original Harbor Master files or sounds.
export const syntheticLevel = `mapSize 1024 768
pacingElement
0 9999
60 1 0 10 0 0 0 0 0
dockElement
512 434
0
0
1
1
0
`;

export function syntheticGame(level = syntheticLevel): Buffer {
  const root = 'Payload/HarborMasterHD.app/';
  const art = readFileSync(new URL('../../public/icon-512.png', import.meta.url));
  return Buffer.from(zipSync({
    [`${root}hmhd0001-texture.png`]: art,
    [`${root}spritesTexture.png`]: art,
    [`${root}hmhd0001.lvl`]: strToU8(level),
    [`${root}HarborMasterSeagulls.mp3`]: new Uint8Array([0, 1, 2, 3]),
  }));
}
