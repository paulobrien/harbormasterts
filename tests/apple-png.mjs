import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { deflateSync } from 'fflate';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function chunk(type, data = new Uint8Array()) {
  const bytes = new Uint8Array(data.length + 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) bytes[4 + i] = type.charCodeAt(i);
  bytes.set(data, 8);
  let crc = 0xffffffff;
  for (const byte of bytes.subarray(4, data.length + 8)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  view.setUint32(data.length + 8, (crc ^ 0xffffffff) >>> 0);
  return bytes;
}

function png(width, height, pixels, { interlace = 0, colour = 6 } = {}) {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width); view.setUint32(4, height);
  ihdr[8] = 8; ihdr[9] = colour; ihdr[12] = interlace;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('CgBI'), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(new Uint8Array(pixels))), chunk('IEND')];
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

const temp = await mkdtemp(join(tmpdir(), 'harbor-apple-png-'));
try {
  const outfile = join(temp, 'png.cjs');
  await build({ entryPoints: [resolve('src/png.ts')], outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' });
  const { decodeApplePng } = await import(pathToFileURL(outfile).href);
  let rendered;
  globalThis.ImageData = class { constructor(data, width, height) { Object.assign(this, { data, width, height }); } };
  globalThis.Image = class { set src(_value) { queueMicrotask(() => this.onload()); } };
  globalThis.document = { createElement: () => ({
    getContext: () => ({ putImageData: data => { rendered = data; } }),
    toBlob: callback => callback(new Blob(['synthetic'], { type: 'image/png' })),
  }) };

  await decodeApplePng(png(2, 1, [0, 32, 64, 128, 128, 0, 0, 0, 0]));
  assert.deepEqual([...rendered.data], [255, 128, 64, 128, 0, 0, 0, 0], 'premultiplied BGRA becomes RGBA');
  await decodeApplePng(png(2, 1, [1, 0, 0, 255, 255, 0, 255, 1, 0]));
  assert.deepEqual([...rendered.data], [255, 0, 0, 255, 0, 255, 0, 255], 'PNG Sub filtering reconstructs adjacent pixels');
  await decodeApplePng(png(2, 2, [0, 0, 0, 255, 255, 0, 0, 255, 0, 255,
    0, 255, 0, 0, 255, 128, 128, 128, 128], { interlace: 1 }));
  assert.deepEqual([...rendered.data], [255, 0, 0, 255, 0, 255, 0, 255,
    0, 0, 255, 255, 255, 255, 255, 128], 'Adam7 passes land at the correct coordinates');
  await assert.rejects(decodeApplePng(new Uint8Array([1, 2, 3])), /Invalid PNG/);
  await assert.rejects(decodeApplePng(png(2, 1, [0, 1])), /Incomplete Apple PNG/);
  await assert.rejects(decodeApplePng(png(1, 1, [5, 0, 0, 0, 255])), /Unsupported PNG filter/);
  await assert.rejects(decodeApplePng(png(1, 1, [0, 0, 0, 0, 255], { colour: 2 })), /Unsupported Apple PNG/);
  console.log('PASS: Apple PNG colour conversion, filters, interlace and malformed image handling');
} finally {
  await rm(temp, { recursive: true, force: true });
}
