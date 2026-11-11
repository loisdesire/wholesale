import { deflateSync } from "node:zlib";

/**
 * Minimal, dependency-free PNG encoder for eval fixtures — this repo has no image
 * library (sharp/canvas/jimp), and these images only need to be real, decodable
 * photos for a vision model to reason about, not realistic product photography.
 * A solid color block is enough to test genuine vision grounding: "does the model
 * use what's actually in the photo," not "can it recognize a dress."
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([length, typeBuf, data, crc]);
}

/** A solid [r,g,b] square, PNG-encoded, base64 — a believable photo-sized attachment. */
export function solidColorPngBase64(rgb: [number, number, number], size = 64): string {
  const [r, g, b] = rgb;
  const row = Buffer.alloc(1 + size * 3); // filter byte 0 + RGB per pixel
  for (let x = 0; x < size; x++) {
    row[1 + x * 3] = r;
    row[1 + x * 3 + 1] = g;
    row[1 + x * 3 + 2] = b;
  }
  const raw = Buffer.concat(Array(size).fill(row));

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const png = Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return png.toString("base64");
}

/** A visually indistinct photo (uniform mid-grey) — stands in for a blurry/unreadable one. */
export function blurryPngBase64(size = 64): string {
  return solidColorPngBase64([128, 128, 128], size);
}

export const EVAL_IMAGE_COLORS = {
  red: [196, 30, 58] as [number, number, number],
  black: [20, 20, 24] as [number, number, number],
};
