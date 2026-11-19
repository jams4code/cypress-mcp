import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  decodePng,
  downscale,
  encodePng,
  scaledScreenshot,
} from "../../src/utils/png.js";

/** A width x height image: left half red, right half blue. */
function halves(width: number, height: number) {
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      pixels[at] = x < width / 2 ? 255 : 0;
      pixels[at + 2] = x < width / 2 ? 0 : 255;
      pixels[at + 3] = 255;
    }
  }
  return { width, height, pixels };
}

describe("png", () => {
  it("round-trips an image through encode and decode", () => {
    const image = halves(8, 4);
    const decoded = decodePng(encodePng(image));
    expect(decoded?.width).toBe(8);
    expect(decoded?.height).toBe(4);
    expect(Buffer.from(decoded!.pixels).equals(Buffer.from(image.pixels))).toBe(true);
  });

  it("scales down by averaging, keeping the aspect ratio", () => {
    const scaled = downscale(halves(2000, 1000), 1000);
    expect([scaled.width, scaled.height]).toEqual([1000, 500]);
    expect(Array.from(scaled.pixels.subarray(0, 4))).toEqual([255, 0, 0, 255]);
    expect(Array.from(scaled.pixels.subarray(999 * 4, 1000 * 4))).toEqual([
      0, 0, 255, 255,
    ]);
  });

  it("returns a narrow screenshot as is and scales a wide one", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cypress-mcp-png-"));
    try {
      const narrow = path.join(dir, "narrow.png");
      const wide = path.join(dir, "wide.png");
      fs.writeFileSync(narrow, encodePng(halves(10, 10)));
      fs.writeFileSync(wide, encodePng(halves(2560, 1440)));

      const same = await scaledScreenshot(narrow);
      expect(Buffer.from(same!.data, "base64").equals(fs.readFileSync(narrow))).toBe(
        true,
      );

      const scaled = await scaledScreenshot(wide);
      expect([scaled?.width, scaled?.height]).toEqual([1000, 563]);
      expect(decodePng(Buffer.from(scaled!.data, "base64"))?.width).toBe(1000);

      expect(await scaledScreenshot(path.join(dir, "missing.png"))).toBeUndefined();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses what it cannot decode", () => {
    expect(decodePng(Buffer.from("not a png"))).toBeUndefined();
  });
});
