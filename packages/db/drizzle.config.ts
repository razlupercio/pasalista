// SPDX-License-Identifier: AGPL-3.0-or-later
import { defineConfig } from "drizzle-kit";
import { DEFAULT_DEV_DATABASE_URL } from "./src/config.ts";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  casing: "snake_case",
  dbCredentials: { url: process.env.DATABASE_URL ?? DEFAULT_DEV_DATABASE_URL },
  strict: true,
  verbose: true,
});
