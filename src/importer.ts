import { unzipSync } from 'fflate';
import { decodeApplePng } from './png';

export interface GameAssets {
  background: HTMLImageElement;
  sprites: HTMLImageElement;
  music: Blob;
  sounds: Record<string, Blob>;
  levelText: string;
}

/** Read an original Harbor Master HD IPA entirely on this device. */
export async function importIpa(file: File): Promise<GameAssets> {
  if (file.size > 120 * 1024 * 1024) throw new Error('This file is too large to be a supported game IPA.');
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(await file.arrayBuffer()), {
      filter: entry => {
        const n = entry.name.toLowerCase();
        return n.startsWith('payload/') && (n.endsWith('/hmhd0001-texture.png') || n.endsWith('/spritestexture.png') || n.endsWith('/hmhd0001.lvl') || n.endsWith('/harbormasterseagulls.mp3') || n.endsWith('.caf'));
      },
    });
  } catch (error) {
    throw new Error('Could not open this IPA. Please select the original Harbor Master HD IPA.', { cause: error });
  }
  const find = (name: string): Uint8Array => {
    const key = Object.keys(files).find(k => k.toLowerCase().endsWith('/' + name.toLowerCase()));
    if (!key) throw new Error(`This IPA is missing ${name}. Please choose Harbor Master HD 2.0.1.`);
    return files[key];
  };
  const levelText = new TextDecoder().decode(find('hmhd0001.lvl'));
  const [background, sprites] = await Promise.all([
    decodeApplePng(find('hmhd0001-texture.png')),
    decodeApplePng(find('spritesTexture.png')),
  ]);
  const sounds: Record<string, Blob> = {};
  for (const [name, data] of Object.entries(files)) {
    if (!name.toLowerCase().endsWith('.caf')) continue;
    try {
      const shortName = name.slice(name.lastIndexOf('/') + 1).replace(/\.caf$/i, '');
      sounds[shortName] = pcmCafToWav(data);
    } catch (error) {
      // Preserve playability if an individual sound uses an unsupported encoding.
      console.warn('Skipping unsupported game sound:', name, error);
    }
  }
  const music = new Blob([new Uint8Array(find('HarborMasterSeagulls.mp3'))], { type: 'audio/mpeg' });
  return { background, sprites, music, sounds, levelText };
}

/** Convert the game's uncompressed Core Audio files to WAV for browser playback. */
function pcmCafToWav(caf: Uint8Array): Blob {
  const d = new DataView(caf.buffer, caf.byteOffset, caf.byteLength);
  const tag = (i: number, count = 4) => String.fromCharCode(...caf.subarray(i, i + count));
  if (caf.length < 8 || tag(0) !== 'caff') throw new Error('Not a CAF file');
  let channels = 0, sampleRate = 0, bits = 0, flags = 0, data: Uint8Array | undefined;
  for (let p = 8; p + 12 <= caf.length;) {
    const id = tag(p);
    const chunkSize = Number(d.getBigInt64(p + 4));
    if (chunkSize < 0 || !Number.isSafeInteger(chunkSize) || p + 12 + chunkSize > caf.length) throw new Error('Invalid CAF chunk');
    const at = p + 12;
    if (id === 'desc' && chunkSize >= 32) {
      sampleRate = d.getFloat64(at);
      if (tag(at + 8) !== 'lpcm') throw new Error('Unsupported CAF audio');
      flags = d.getUint32(at + 12);
      channels = d.getUint32(at + 24);
      bits = d.getUint32(at + 28);
    } else if (id === 'data' && chunkSize >= 4) data = caf.subarray(at + 4, at + chunkSize);
    p = at + chunkSize;
  }
  if (!data || !channels || !sampleRate || bits !== 16 || (flags & 1)) throw new Error('Unsupported CAF PCM format');
  const pcm = new Uint8Array(data);
  // CAF flag 2 indicates little-endian data. WAV PCM must be little endian.
  if (!(flags & 2)) for (let i = 0; i + 1 < pcm.length; i += 2) [pcm[i], pcm[i + 1]] = [pcm[i + 1], pcm[i]];
  const wav = new Uint8Array(44 + pcm.length), w = new DataView(wav.buffer);
  const put = (i: number, s: string) => { for (let j = 0; j < s.length; j++) wav[i + j] = s.charCodeAt(j); };
  put(0, 'RIFF'); w.setUint32(4, 36 + pcm.length, true); put(8, 'WAVE');
  put(12, 'fmt '); w.setUint32(16, 16, true); w.setUint16(20, 1, true);
  w.setUint16(22, channels, true); w.setUint32(24, sampleRate, true);
  w.setUint32(28, sampleRate * channels * 2, true); w.setUint16(32, channels * 2, true);
  w.setUint16(34, 16, true); put(36, 'data'); w.setUint32(40, pcm.length, true);
  wav.set(pcm, 44);
  return new Blob([wav], { type: 'audio/wav' });
}
