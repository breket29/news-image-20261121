import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32 } from "node:zlib";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_BYTES = 1024 * 1024;
const MAX_DIMENSION = 1024;

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, "poster.png");
const outDir = "/output";
const target = join(outDir, "entry.png");

if (!existsSync(source)) {
  throw new Error(`poster.png not found next to main.ts (looked in ${here})`);
}

const bytes = readFileSync(source);
const size = statSync(source).size;

if (size > MAX_BYTES) {
  throw new Error(`poster.png is ${size} bytes, over the 1 MiB limit`);
}

if (bytes.length < 33 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
  throw new Error("poster.png does not start with the PNG signature");
}

// IHDR is the first chunk: 8-byte signature, 4-byte length, "IHDR", then
// 4-byte width and 4-byte height, both big-endian.
const width = bytes.readUInt32BE(16);
const height = bytes.readUInt32BE(20);
if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
  throw new Error(`poster.png is ${width}x${height}, over the 1024x1024 limit`);
}

// Walk every chunk and check its CRC, so a truncated or corrupted file
// is rejected instead of copied. The walk must end exactly at the end
// of the file, on the IEND chunk: that is what makes the PNG whole.
let offset = 8;
let sawIend = false;
while (offset < bytes.length) {
  if (offset + 8 > bytes.length) {
    throw new Error("poster.png ends mid-chunk");
  }
  const length = bytes.readUInt32BE(offset);
  const type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
  const dataEnd = offset + 8 + length;
  if (dataEnd + 4 > bytes.length) {
    throw new Error(`poster.png chunk ${type} is truncated`);
  }
  const storedCrc = bytes.readUInt32BE(dataEnd);
  const actualCrc = crc32(bytes.subarray(offset + 4, dataEnd));
  if (storedCrc !== actualCrc) {
    throw new Error(`poster.png chunk ${type} fails its checksum`);
  }
  if (type === "IEND") {
    sawIend = true;
    offset = dataEnd + 4;
    break;
  }
  offset = dataEnd + 4;
}
if (!sawIend || offset !== bytes.length) {
  throw new Error("poster.png does not end cleanly on its IEND chunk");
}

mkdirSync(outDir, { recursive: true });
copyFileSync(source, target);
console.log(`Wrote ${target} (${width}x${height}, ${size} bytes)`);
