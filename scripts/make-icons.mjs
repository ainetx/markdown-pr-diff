// Generates the placeholder extension icons: a rounded square split into a
// red "before" half and a green "after" half, with a light divider.
// Hand-rolled PNG encoder — avoids pulling an image library into devDependencies.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const SIZES = [16, 32, 48, 128];
const BG = [13, 17, 23];
const LEFT = [218, 54, 51];
const RIGHT = [35, 134, 54];
const DIVIDER = [110, 118, 129];

function crc32(buf) {
  let c,
    crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function render(size) {
  const r = Math.round(size * 0.18); // corner radius
  const pad = Math.max(1, Math.round(size * 0.08));
  const mid = size / 2;
  const half = Math.max(1, Math.round(size * 0.045)); // half-width of the divider
  const rows = [];

  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4); // filter byte + RGBA
    for (let x = 0; x < size; x++) {
      const o = 1 + x * 4;
      // Rounded-square mask.
      const cx = Math.min(Math.max(x + 0.5, r), size - r);
      const cy = Math.min(Math.max(y + 0.5, r), size - r);
      const inside = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r;
      if (!inside) {
        row.writeUInt32BE(0, o); // transparent
        continue;
      }
      let color = BG;
      const inBand = y >= pad && y < size - pad;
      if (inBand) {
        if (Math.abs(x + 0.5 - mid) <= half) color = DIVIDER;
        else if (x + 0.5 < mid && x >= pad) color = LEFT;
        else if (x + 0.5 > mid && x < size - pad) color = RIGHT;
      }
      row[o] = color[0];
      row[o + 1] = color[1];
      row[o + 2] = color[2];
      row[o + 3] = 255;
    }
    rows.push(row);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(new URL('../icons/', import.meta.url), { recursive: true });
for (const size of SIZES) {
  const png = render(size);
  const path = new URL(`../icons/icon${size}.png`, import.meta.url);
  writeFileSync(path, png);
  console.log(
    `icon${size}.png  ${png.length} bytes  sha1=${createHash('sha1').update(png).digest('hex').slice(0, 8)}`,
  );
}
