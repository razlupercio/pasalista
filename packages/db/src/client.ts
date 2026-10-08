// SPDX-License-Identifier: AGPL-3.0-or-later
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index.ts";

export function createDb(connectionString: string, options: { max?: number } = {}) {
  const pool = new pg.Pool({ connectionString, max: options.max ?? 10 });
  const db = drizzle({ client: pool, schema, casing: "snake_case" });
  return { db, pool };
}

export type Database = ReturnType<typeof createDb>["db"];
