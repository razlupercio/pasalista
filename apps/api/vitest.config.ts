// SPDX-License-Identifier: AGPL-3.0-or-later
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    globalSetup: ["test/global-setup.ts"],
    // Integration tests share one database; run files one at a time for predictable state.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
