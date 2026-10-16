import fs from 'fs';
import path from 'path';

/**
 * @internal
 */
interface ImageDimensions {
  width: number;
  height: number;
}

/**
 * Extracts width and height from JPEG, PNG, and SVG file headers asynchronously.
 * Uses surgical byte-offset reading to avoid loading full image buffers into memory.
 */
export async function getLocalImageDimensions(imageUrl: string): Promise<ImageDimensions | null> {
  if (!imageUrl || imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
    return null;
  }

  let absolutePath = imageUrl;
  if (imageUrl.startsWith('/')) {
    absolutePath = path.join(process.cwd(), 'public', imageUrl);
  }

  let fileHandle: fs.promises.FileHandle | null = null;
  try {
    fileHandle = await fs.promises.open(absolutePath, 'r');
    const ext = path.extname(absolutePath).toLowerCase();

    if (ext === '.png') {
      const buffer = Buffer.alloc(24);
      const { bytesRead } = await fileHandle.read(buffer, 0, 24, 0);

      // PNG signature: 89 50 4E 47 0D 0A 1A 0A
      if (
        bytesRead >= 24 &&
        buffer[0] === 0x89 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x4e &&
        buffer[3] === 0x47
      ) {
        // IHDR chunk starts at offset 12. Length (4), Chunk type (4)
        // IHDR data starts at offset 16. Width (4), Height (4)
        const width = buffer.readUInt32BE(16);
        const height = buffer.readUInt32BE(20);
        return { width, height };
      }
    } else if (ext === '.jpg' || ext === '.jpeg') {
      let offset = 0;
      const buf = Buffer.alloc(2);
      const { bytesRead: firstRead } = await fileHandle.read(buf, 0, 2, offset);
      if (firstRead === 2 && buf[0] === 0xff && buf[1] === 0xd8) {
        offset = 2;
        while (true) {
          const { bytesRead } = await fileHandle.read(buf, 0, 2, offset);
          if (bytesRead < 2) break;

          if (buf[0] !== 0xff) break; // Not a marker

          const markerType = buf[1] as number;
          if (
            markerType >= 0xc0 &&
            markerType <= 0xcf &&
            markerType !== 0xc4 &&
            markerType !== 0xc8 &&
            markerType !== 0xcc
          ) {
            const sofBuf = Buffer.alloc(9);
            const { bytesRead: sofRead } = await fileHandle.read(sofBuf, 0, 9, offset + 2);
            if (sofRead < 9) break;
            const height = sofBuf.readUInt16BE(3);
            const width = sofBuf.readUInt16BE(5);
            return { width, height };
          } else {
            const lenBuf = Buffer.alloc(2);
            const { bytesRead: lenRead } = await fileHandle.read(lenBuf, 0, 2, offset + 2);
            if (lenRead < 2) break;
            const len = lenBuf.readUInt16BE(0);
            offset += 2 + len;
          }
        }
      }
    } else if (ext === '.svg') {
      const svgBuffer = Buffer.alloc(4096);
      const { bytesRead } = await fileHandle.read(svgBuffer, 0, 4096, 0);
      const content = svgBuffer.toString('utf8', 0, bytesRead);

      const svgTagMatch = content.match(/<svg[^>]*>/i);
      if (svgTagMatch) {
        const svgTag = svgTagMatch[0];
        const widthMatch = svgTag.match(/\bwidth=["']?([\d.]+)["']?/i);
        const heightMatch = svgTag.match(/\bheight=["']?([\d.]+)["']?/i);
        const viewBoxMatch = svgTag.match(/\bviewBox=["']?[\d.]+[,\s]+[\d.]+[,\s]+([\d.]+)[,\s]+([\d.]+)["']?/i);

        if (widthMatch && heightMatch) {
          return {
            width: Math.round(parseFloat(widthMatch[1])),
            height: Math.round(parseFloat(heightMatch[1])),
          };
        }

        if (viewBoxMatch) {
          return {
            width: Math.round(parseFloat(viewBoxMatch[1])),
            height: Math.round(parseFloat(viewBoxMatch[2])),
          };
        }
      }
    }
  } catch {
    // Return null if file cannot be opened or read
  } finally {
    if (fileHandle) {
      await fileHandle.close().catch(() => {});
    }
  }

  return null;
}
