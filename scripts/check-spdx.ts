// SPDX-License-Identifier: AGPL-3.0-or-later
// Fails if a tracked source file lacks the SPDX license header (CLAUDE.md code conventions).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const HEADER = "SPDX-License-Identifier: AGPL-3.0-or-later";
const SOURCE = /\.(ts|tsx|js|mjs|css)$/;
const EXCLUDED = [
  /^packages\/api-client\/src\/schema\.d\.ts$/,
  /next-env\.d\.ts$/,
  /^packages\/db\/migrations\//,
];

const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
  encoding: "utf8",
})
  .split("\n")
  .filter((file) => SOURCE.test(file) && !EXCLUDED.some((pattern) => pattern.test(file)));

const missing = files.filter((file) => {
  try {
    return !readFileSync(file, "utf8").split("\n", 3).join("\n").includes(HEADER);
  } catch {
    return false; // deleted in the working tree
  }
});

if (missing.length > 0) {
  console.error(`Missing "${HEADER}" header in:\n  ${missing.join("\n  ")}`);
  process.exit(1);
}
console.log(`SPDX headers OK (${files.length} files)`);
