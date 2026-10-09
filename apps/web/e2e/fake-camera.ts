// SPDX-License-Identifier: AGPL-3.0-or-later
// Builds a Y4M video showing a QR code, used as Chromium's fake camera so e2e tests exercise
// the real scanner (camera, WASM decoder, API and result screen).
import { writeFileSync } from "node:fs";
import QRCode from "qrcode";

export function writeQrVideo(path: string, text: string): void {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const modules = qr.modules.size;
  const quiet = 4;
  const scale = Math.floor(400 / (modules + quiet * 2));
  const side = (modules + quiet * 2) * scale;
  const size = side % 2 === 0 ? side : side + 1; // 4:2:0 needs even dimensions

  const luma = Buffer.alloc(size * size, 255);
  for (let row = 0; row < modules; row++) {
    for (let col = 0; col < modules; col++) {
      if (!qr.modules.get(row, col)) continue;
      for (let dy = 0; dy < scale; dy++) {
        const y = (row + quiet) * scale + dy;
        luma.fill(0, y * size + (col + quiet) * scale, y * size + (col + quiet + 1) * scale);
      }
    }
  }
  const chroma = Buffer.alloc((size / 2) * (size / 2), 128);
  const frame = Buffer.concat([Buffer.from("FRAME\n"), luma, chroma, chroma]);
  const header = Buffer.from(`YUV4MPEG2 W${size} H${size} F10:1 Ip A1:1 C420jpeg\n`);
  writeFileSync(path, Buffer.concat([header, frame, frame, frame]));
}
