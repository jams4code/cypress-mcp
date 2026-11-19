// Copyright (c) 2026 JADEV GROUP SARL
// SPDX-License-Identifier: Apache-2.0

/** Width from a PNG's IHDR chunk, without decoding the image. */
export function decodePngWidth(bytes) {
  if (bytes.subarray(1, 4).toString("latin1") !== "PNG") {
    throw new Error("not a PNG");
  }
  return bytes.readUInt32BE(16);
}
