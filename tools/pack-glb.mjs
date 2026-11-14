// Pack a separate-file glTF (json + .bin + texture images) into one self-contained .glb.
// usage: node tools/pack-glb.mjs <model.gltf> <out.glb>
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';

const [src, out] = process.argv.slice(2);
const dir = dirname(src);
const json = JSON.parse(readFileSync(src, 'utf8'));
const chunks = [];
let offset = 0;
const push = (buf) => {
  const start = offset;
  chunks.push(buf);
  offset += buf.length;
  const pad = (4 - (offset % 4)) % 4;
  if (pad) {
    chunks.push(Buffer.alloc(pad));
    offset += pad;
  }
  return start;
};
// buffers: concatenate all into one, remap bufferViews
const bufferStarts = json.buffers.map((b) => push(readFileSync(join(dir, b.uri))));
for (const bv of json.bufferViews) {
  bv.byteOffset = (bv.byteOffset ?? 0) + bufferStarts[bv.buffer ?? 0];
  bv.buffer = 0;
}
// images: embed as bufferViews
const mime = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
for (const img of json.images ?? []) {
  if (!img.uri) continue;
  const data = readFileSync(join(dir, decodeURIComponent(img.uri)));
  const start = push(data);
  json.bufferViews.push({ buffer: 0, byteOffset: start, byteLength: data.length });
  img.bufferView = json.bufferViews.length - 1;
  img.mimeType = mime[extname(img.uri).toLowerCase()] ?? 'image/jpeg';
  delete img.uri;
}
json.buffers = [{ byteLength: offset }];
const bin = Buffer.concat(chunks);
let jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
if (jsonBuf.length % 4) jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(4 - (jsonBuf.length % 4), 0x20)]);
const header = Buffer.alloc(12);
header.write('glTF', 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + bin.length, 8);
const jh = Buffer.alloc(8);
jh.writeUInt32LE(jsonBuf.length, 0);
jh.write('JSON', 4);
const bh = Buffer.alloc(8);
bh.writeUInt32LE(bin.length, 0);
bh.writeUInt32LE(0x004e4942, 4);
writeFileSync(out, Buffer.concat([header, jh, jsonBuf, bh, bin]));
console.log(out, Math.round((12 + 16 + jsonBuf.length + bin.length) / 1024), 'KB');
