/**
 * The PNG chunk rewrite the CLI and the React export share. Plain typed
 * arrays, no Node Buffer and no zlib, so the browser bundle can import it.
 */

/** The most pixels one PNG may have. A 1000000 px canvas made the rasterizer abort the process. */
export const PNG_PIXELS_MAX = 100_000_000;

let crcTable: Uint32Array | undefined;

/** CRC-32 of a PNG chunk (ISO 3309); a table, because the browser bundle has no zlib. */
export function crc32(bytes: Uint8Array): number {
  crcTable ??= Uint32Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * The PNG with a pHYs chunk of 96 dpi times `scale` right after IHDR, any
 * earlier pHYs dropped. Without it PowerPoint, Keynote and Word place a
 * scale-2 PNG at twice the chart's size. Layout px are CSS px, so a
 * slide or print chart places at its natural pt size at every scale.
 */
export function withPhysicalSize(png: Uint8Array, scale: number): Uint8Array {
  if (!PNG_SIGNATURE.every((byte, index) => png[index] === byte)) return png; // not a PNG: leave the bytes alone
  const perMetre = Math.round((96 * scale) / 0.0254);
  const chunk = new Uint8Array(21);
  const out = new DataView(chunk.buffer);
  out.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // 'pHYs'
  out.setUint32(8, perMetre);
  out.setUint32(12, perMetre);
  chunk[16] = 1; // unit: metre
  out.setUint32(17, crc32(chunk.subarray(4, 17)));
  const source = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const parts: Uint8Array[] = [png.subarray(0, 8)];
  for (let offset = 8; offset + 12 <= png.length;) {
    const end = offset + 12 + source.getUint32(offset);
    const type = String.fromCharCode(...png.subarray(offset + 4, offset + 8));
    if (type !== 'pHYs') parts.push(png.subarray(offset, end));
    if (type === 'IHDR') parts.push(chunk);
    offset = end;
  }
  const result = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let at = 0;
  for (const part of parts) {
    result.set(part, at);
    at += part.length;
  }
  return result;
}
