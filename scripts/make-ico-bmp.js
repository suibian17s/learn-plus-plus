/**
 * Generate BMP-based ICO from PNG.
 * BMP format ICOs work better with rcedit (used by electron-builder)
 * than PNG-based ICOs, because rcedit only parses BMP entries.
 */
const fs = require('fs');
const path = require('path');
const pngjs = require('png-js');

const SIZES = [16, 24, 32, 48, 64, 128, 256];

function decodePNG(filePath) {
  return new Promise((resolve, reject) => {
    pngjs.decode(filePath, (pixels) => {
      if (!pixels) return reject(new Error('Decode returned falsy'));
      // pixels is a Buffer-like (Uint8Array) of RGBA data
      resolve({ pixels, width: 0, height: 0 });
    });
  });
}

// png-js doesn't expose width/height directly via decode().
// We need to parse the IHDR chunk ourselves.
function readPNG(filePath) {
  const buf = fs.readFileSync(filePath);
  // PNG signature is 8 bytes: 89 50 4E 47 0D 0A 1A 0A
  // IHDR starts at byte 8: 4 bytes length, 4 bytes "IHDR"
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return { buf, width, height };
}

function bilinearResize(src, srcW, srcH, dstW, dstH) {
  const result = new Uint8Array(dstW * dstH * 4);
  const xRatio = srcW / dstW;
  const yRatio = srcH / dstH;

  for (let y = 0; y < dstH; y++) {
    for (let x = 0; x < dstW; x++) {
      const srcX = x * xRatio;
      const srcY = y * yRatio;
      const x0 = Math.floor(srcX);
      const y0 = Math.floor(srcY);
      const x1 = Math.min(x0 + 1, srcW - 1);
      const y1 = Math.min(y0 + 1, srcH - 1);
      const dx = srcX - x0;
      const dy = srcY - y0;

      const dstIdx = (y * dstW + x) * 4;

      // Read 4 corner pixels (RGBA)
      const i00 = (y0 * srcW + x0) * 4;
      const i10 = (y0 * srcW + x1) * 4;
      const i01 = (y1 * srcW + x0) * 4;
      const i11 = (y1 * srcW + x1) * 4;

      for (let c = 0; c < 4; c++) {
        const v = (1 - dx) * (1 - dy) * src[i00 + c]
          + dx * (1 - dy) * src[i10 + c]
          + (1 - dx) * dy * src[i01 + c]
          + dx * dy * src[i11 + c];
        result[dstIdx + c] = Math.round(Math.max(0, Math.min(255, v)));
      }
    }
  }
  return result;
}

/**
 * Build a BMP-format entry for ICO.
 * Returns Buffer containing:
 *   BITMAPINFOHEADER (40 bytes)
 *   XOR pixel data (32bpp BGRA, bottom-up)
 *   AND mask (1bpp, bottom-up, padded to DWORD)
 */
function buildBMPEntry(rgbaPixels, w, h) {
  // BITMAPINFOHEADER
  const headerSize = 40;
  const pixelDataSize = w * h * 4;
  const andRowSize = Math.floor((w + 31) / 32) * 4; // DWORD-aligned AND mask row
  const andSize = andRowSize * h;
  const total = headerSize + pixelDataSize + andSize;
  const buf = Buffer.alloc(total);

  let off = 0;
  // biSize
  buf.writeUInt32LE(40, off); off += 4;
  // biWidth
  buf.writeInt32LE(w, off); off += 4;
  // biHeight = h * 2 (to include AND mask per ICO spec)
  buf.writeInt32LE(h * 2, off); off += 4;
  // biPlanes
  buf.writeUInt16LE(1, off); off += 2;
  // biBitCount = 32
  buf.writeUInt16LE(32, off); off += 2;
  // biCompression = 0 (BI_RGB)
  buf.writeUInt32LE(0, off); off += 4;
  // biSizeImage (0 is fine for BI_RGB)
  buf.writeUInt32LE(0, off); off += 4;
  // biXPelsPerMeter
  buf.writeInt32LE(0, off); off += 4;
  // biYPelsPerMeter
  buf.writeInt32LE(0, off); off += 4;
  // biClrUsed
  buf.writeUInt32LE(0, off); off += 4;
  // biClrImportant
  buf.writeUInt32LE(0, off); off += 4;
  // off should be 40 now

  // XOR pixel data: bottom-up, BGRA
  const xorStart = off;
  for (let row = h - 1; row >= 0; row--) {
    for (let col = 0; col < w; col++) {
      const srcIdx = (row * w + col) * 4;
      buf[off++] = rgbaPixels[srcIdx + 2]; // B
      buf[off++] = rgbaPixels[srcIdx + 1]; // G
      buf[off++] = rgbaPixels[srcIdx + 0]; // R
      buf[off++] = rgbaPixels[srcIdx + 3]; // A
    }
  }
  // off should be at start of AND mask now

  // AND mask: 0 for fully opaque, 1 for transparent
  // For fully opaque icon, all zeros
  // Skip to end (it's already zero-filled)
  off += andSize;

  return buf;
}

async function main() {
  const srcPath = path.resolve(__dirname, '..', 'resources', 'icon.png');
  const outPath = path.resolve(__dirname, '..', 'resources', 'icon.ico');

  console.log('Reading source PNG...');
  const { buf: pngBuf, width: srcW, height: srcH } = readPNG(srcPath);
  console.log(`  Source: ${srcW}x${srcH}`);

  console.log('Decoding PNG pixels...');
  const srcPixels = await decodePNG(srcPath);
  console.log(`  Decoded ${srcPixels.pixels.length} bytes`);

  const entries = [];
  const icoHeaderSize = 6; // reserved(2) + type(2) + count(2)

  for (const size of SIZES) {
    console.log(`Resizing to ${size}x${size}...`);
    const pixels = bilinearResize(srcPixels.pixels, srcW, srcH, size, size);
    const entryData = buildBMPEntry(pixels, size, size);
    entries.push({ size, data: entryData });
    console.log(`  Entry: ${entryData.length} bytes`);
  }

  // Assemble ICO
  const dirEntrySize = 16;
  let dataOffset = icoHeaderSize + entries.length * dirEntrySize;
  const parts = [Buffer.alloc(icoHeaderSize + entries.length * dirEntrySize)];

  // Write header
  const header = parts[0];
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type = icon
  header.writeUInt16LE(entries.length, 4); // count

  let dirOff = 6;
  for (let i = 0; i < entries.length; i++) {
    const { size, data } = entries[i];
    const w = size === 256 ? 0 : size;
    const h = size === 256 ? 0 : size;
    header.writeUInt8(w, dirOff);
    header.writeUInt8(h, dirOff + 1);
    header.writeUInt8(0, dirOff + 2); // palette
    header.writeUInt8(0, dirOff + 3); // reserved
    header.writeUInt16LE(1, dirOff + 4); // planes
    header.writeUInt16LE(32, dirOff + 6); // bpp
    header.writeUInt32LE(data.length, dirOff + 8); // size
    header.writeUInt32LE(dataOffset, dirOff + 12); // offset
    dataOffset += data.length;
    dirOff += 16;
  }

  // Append entry data
  for (const { data } of entries) {
    parts.push(data);
  }

  const icoData = Buffer.concat(parts);
  fs.writeFileSync(outPath, icoData);
  console.log(`\nWritten ${icoData.length} bytes to ${outPath}`);
  console.log('Done.');
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
