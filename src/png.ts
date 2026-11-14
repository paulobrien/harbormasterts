import { inflateSync } from 'fflate';

/** Decode Apple's CgBI-optimised PNG into an ordinary browser image.
 * The game stores colour bytes in premultiplied BGRA order and raw DEFLATE. */
export async function decodeApplePng(bytes: Uint8Array): Promise<HTMLImageElement> {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!sig.every((b, i) => bytes[i] === b)) throw new Error('Invalid PNG image');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0, height = 0, depth = 0, colour = 0, interlace = 0, apple = false;
  const chunks: Uint8Array[] = [];
  for (let off = 8; off + 12 <= bytes.length;) {
    const len = view.getUint32(off);
    if (off + 12 + len > bytes.length) throw new Error('Truncated PNG image');
    const type = String.fromCharCode(...bytes.subarray(off + 4, off + 8));
    const start = off + 8;
    if (type === 'CgBI') apple = true;
    if (type === 'IHDR') {
      width = view.getUint32(start); height = view.getUint32(start + 4);
      depth = bytes[start + 8]; colour = bytes[start + 9]; interlace = bytes[start + 12];
    } else if (type === 'IDAT') chunks.push(bytes.subarray(start, start + len));
    off += len + 12;
    if (type === 'IEND') break;
  }
  if (!width || !height || width * height > 16000000) throw new Error('PNG has unsupported dimensions');
  if (!apple) return loadImage(new Blob([bytes as BlobPart], { type: 'image/png' }));
  if (depth !== 8 || colour !== 6 || (interlace !== 0 && interlace !== 1)) {
    throw new Error('Unsupported Apple PNG colour format');
  }
  const total = chunks.reduce((n, chunk) => n + chunk.length, 0);
  const compressed = new Uint8Array(total); let chunkOffset = 0;
  for (const chunk of chunks) { compressed.set(chunk, chunkOffset); chunkOffset += chunk.length; }
  const decoded = inflateSync(compressed);
  const rgba = new Uint8ClampedArray(width * height * 4);
  // Adam7 pass geometry; for ordinary PNGs use one full-image pass.
  const passes = interlace ? [[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]] : [[0,0,1,1]];
  let pos = 0;
  for (const [x0, y0, dx, dy] of passes) {
    const w = Math.max(0, Math.ceil((width - x0) / dx));
    const h = Math.max(0, Math.ceil((height - y0) / dy));
    if (!w || !h) continue;
    const rowLength = w * 4;
    let previous = new Uint8Array(rowLength);
    for (let y = 0; y < h; y++) {
      if (pos + 1 + rowLength > decoded.length) throw new Error('Incomplete Apple PNG');
      const filter = decoded[pos++];
      const row = new Uint8Array(rowLength);
      for (let x = 0; x < rowLength; x++) {
        const raw = decoded[pos++];
        const left = x >= 4 ? row[x - 4] : 0;
        const up = previous[x];
        const upperLeft = x >= 4 ? previous[x - 4] : 0;
        let add = 0;
        if (filter === 1) add = left;
        else if (filter === 2) add = up;
        else if (filter === 3) add = Math.floor((left + up) / 2);
        else if (filter === 4) {
          const p = left + up - upperLeft;
          const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upperLeft);
          add = pa <= pb && pa <= pc ? left : pb <= pc ? up : upperLeft;
        } else if (filter !== 0) throw new Error('Unsupported PNG filter');
        row[x] = (raw + add) & 255;
      }
      for (let x = 0; x < w; x++) {
        const src = x * 4, alpha = row[src + 3];
        const dst = ((y0 + y * dy) * width + x0 + x * dx) * 4;
        if (alpha) {
          rgba[dst] = Math.min(255, Math.round(row[src + 2] * 255 / alpha));
          rgba[dst + 1] = Math.min(255, Math.round(row[src + 1] * 255 / alpha));
          rgba[dst + 2] = Math.min(255, Math.round(row[src] * 255 / alpha));
        }
        rgba[dst + 3] = alpha;
      }
      previous = row;
    }
  }
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is unavailable');
  ctx.putImageData(new ImageData(rgba, width, height), 0, 0);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('Could not convert game artwork')), 'image/png'));
  return loadImage(blob);
}

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob); const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read game artwork')); };
    image.src = url;
  });
}
