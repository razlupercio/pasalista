// SPDX-License-Identifier: AGPL-3.0-or-later
// Copies the QR decoder's WebAssembly file into public/ so the scanner loads it from our own
// origin. zxing-wasm otherwise downloads it from a third-party CDN (jsDelivr), which would leak
// usage to a third party, break offline scanning (Phase 4b) and conflict with a strict CSP.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
// zxing-wasm is a transitive dependency (scanner → barcode-detector → zxing-wasm); resolve it
// through each package's own exports so pnpm's strict layout is respected.
const fromScanner = createRequire(require.resolve("@yudiel/react-qr-scanner"));
const fromDetector = createRequire(fromScanner.resolve("barcode-detector/ponyfill"));
const source = fromDetector.resolve("zxing-wasm/reader/zxing_reader.wasm");
const targetDir = fileURLToPath(new URL("../public/zxing/", import.meta.url));
mkdirSync(targetDir, { recursive: true });
copyFileSync(source, join(targetDir, "zxing_reader.wasm"));
console.log("zxing_reader.wasm copied to public/zxing/");
