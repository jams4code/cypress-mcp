// Copyright (c) 2026 JADEV GROUP SARL
// SPDX-License-Identifier: Apache-2.0

// Scales Cypress screenshots down for image content. A Retina screenshot is
// 2560x1440 (about 1,800 image tokens and several MB of base64); at 1,000 px
// wide it is a few hundred KB and still readable. Plain Node (zlib) so the
// package keeps no native dependency. Handles the PNGs browsers write: 8-bit,
// non-interlaced, grey, RGB, palette or with alpha.
import { crc32, deflateSync, inflateSync } from "node:zlib";
import fs from "node:fs/promises";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface ScaledImage {
  /** Base64 PNG */
  readonly data: string;
  readonly mimeType: "image/png";
  readonly width: number;
  readonly height: number;
}

/** Default width for image content sent to the agent. */
export const IMAGE_WIDTH = 1_000;

/**
 * The screenshot as a PNG at most `maxWidth` wide. Returns the file as is
 * when it is already narrow enough, and undefined when it cannot be read or
 * uses a PNG feature this decoder does not handle.
 */
export async function scaledScreenshot(
  file: string,
  maxWidth = IMAGE_WIDTH,
): Promise<ScaledImage | undefined> {
  let bytes: Buffer;
  try {
    bytes = await fs.readFile(file);
  } catch {
    return undefined;
  }
  const image = decodePng(bytes);
  if (!image) return undefined;
  if (image.width <= maxWidth) {
    return {
      data: bytes.toString("base64"),
      mimeType: "image/png",
      width: image.width,
      height: image.height,
    };
  }
  const scaled = downscale(image, maxWidth);
  return {
    data: encodePng(scaled).toString("base64"),
    mimeType: "image/png",
    width: scaled.width,
    height: scaled.height,
  };
}

export interface Rgba {
  readonly width: number;
  readonly height: number;
  /** 4 bytes per pixel */
  readonly pixels: Uint8Array;
}

/** Exported for tests. */
export function decodePng(bytes: Buffer): Rgba | undefined {
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(SIGNATURE)) return undefined;

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette: Buffer | undefined;
  let transparency: Buffer | undefined;
  const data: Buffer[] = [];

  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("latin1", offset + 4, offset + 8);
    const chunk = bytes.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === "IHDR") {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      bitDepth = chunk[8]!;
      colorType = chunk[9]!;
      interlace = chunk[12]!;
    } else if (type === "PLTE") {
      palette = chunk;
    } else if (type === "tRNS") {
      transparency = chunk;
    } else if (type === "IDAT") {
      data.push(chunk);
    } else if (type === "IEND") {
      break;
    }
  }

  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!width || !height || bitDepth !== 8 || interlace !== 0 || channels === undefined) {
    return undefined;
  }
  if (colorType === 3 && !palette) return undefined;

  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(data));
  } catch {
    return undefined;
  }
  const stride = width * channels;
  if (raw.length < height * (stride + 1)) return undefined;

  const pixels = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = new Uint8Array(
      raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)),
    );
    unfilter(filter, line, previous, channels);
    for (let x = 0; x < width; x++) {
      const out = (y * width + x) * 4;
      const at = x * channels;
      switch (colorType) {
        case 0:
          pixels[out] = pixels[out + 1] = pixels[out + 2] = line[at]!;
          pixels[out + 3] = 255;
          break;
        case 2:
          pixels[out] = line[at]!;
          pixels[out + 1] = line[at + 1]!;
          pixels[out + 2] = line[at + 2]!;
          pixels[out + 3] = 255;
          break;
        case 3: {
          const index = line[at]!;
          pixels[out] = palette![index * 3] ?? 0;
          pixels[out + 1] = palette![index * 3 + 1] ?? 0;
          pixels[out + 2] = palette![index * 3 + 2] ?? 0;
          pixels[out + 3] = transparency?.[index] ?? 255;
          break;
        }
        case 4:
          pixels[out] = pixels[out + 1] = pixels[out + 2] = line[at]!;
          pixels[out + 3] = line[at + 1]!;
          break;
        default:
          pixels[out] = line[at]!;
          pixels[out + 1] = line[at + 1]!;
          pixels[out + 2] = line[at + 2]!;
          pixels[out + 3] = line[at + 3]!;
      }
    }
    previous = line;
  }
  return { width, height, pixels };
}

function unfilter(
  filter: number,
  line: Uint8Array,
  previous: Uint8Array,
  bpp: number,
): void {
  for (let i = 0; i < line.length; i++) {
    const left = i >= bpp ? line[i - bpp]! : 0;
    const up = previous[i]!;
    const upLeft = i >= bpp ? previous[i - bpp]! : 0;
    let add = 0;
    switch (filter) {
      case 1:
        add = left;
        break;
      case 2:
        add = up;
        break;
      case 3:
        add = (left + up) >> 1;
        break;
      case 4: {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        add = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
        break;
      }
    }
    line[i] = (line[i]! + add) & 0xff;
  }
}

/** Area average: each output pixel is the mean of the input pixels it covers. */
export function downscale(image: Rgba, maxWidth: number): Rgba {
  const scale = maxWidth / image.width;
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const pixels = new Uint8Array(width * height * 4);
  const xRatio = image.width / width;
  const yRatio = image.height / height;

  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y * yRatio);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * yRatio));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * xRatio);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * xRatio));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let count = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const at = (sy * image.width + sx) * 4;
          r += image.pixels[at]!;
          g += image.pixels[at + 1]!;
          b += image.pixels[at + 2]!;
          a += image.pixels[at + 3]!;
          count++;
        }
      }
      const out = (y * width + x) * 4;
      pixels[out] = Math.round(r / count);
      pixels[out + 1] = Math.round(g / count);
      pixels[out + 2] = Math.round(b / count);
      pixels[out + 3] = Math.round(a / count);
    }
  }
  return { width, height, pixels };
}

/** RGBA PNG with the Sub filter, which compresses screenshots well. */
export function encodePng(image: Rgba): Buffer {
  const stride = image.width * 4;
  const raw = Buffer.alloc(image.height * (stride + 1));
  for (let y = 0; y < image.height; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 1;
    for (let i = 0; i < stride; i++) {
      const value = image.pixels[y * stride + i]!;
      const left = i >= 4 ? image.pixels[y * stride + i - 4]! : 0;
      raw[rowStart + 1 + i] = (value - left) & 0xff;
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(image.width, 0);
  header.writeUInt32BE(image.height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 6 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}
