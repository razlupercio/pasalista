// SPDX-License-Identifier: AGPL-3.0-or-later
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb } from "./client.ts";
import { DEFAULT_DEV_DATABASE_URL } from "./config.ts";

export const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));

export async function runMigrations(connectionString: string): Promise<void> {
  const { db, pool } = createDb(connectionString, { max: 1 });
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await pool.end();
  }
}

if (import.meta.main) {
  await runMigrations(process.env.DATABASE_URL ?? DEFAULT_DEV_DATABASE_URL);
  console.log("Migrations applied");
}
