// SPDX-License-Identifier: AGPL-3.0-or-later
import { runMigrations } from "@pasalista/db";
import pg from "pg";
import { TEST_DATABASE_URL } from "./database-url.ts";

/** Creates the test database if needed and applies migrations. Never drops anything. */
export default async function setup(): Promise<void> {
  const target = new URL(TEST_DATABASE_URL);
  const databaseName = target.pathname.slice(1);
  const admin = new URL(TEST_DATABASE_URL);
  admin.pathname = "/postgres";

  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const { rowCount } = await client.query("select 1 from pg_database where datname = $1", [
      databaseName,
    ]);
    if (!rowCount) {
      // Identifiers cannot be bound as parameters; escapeIdentifier quotes them safely.
      await client.query(`create database ${client.escapeIdentifier(databaseName)}`);
    }
  } finally {
    await client.end();
  }
  await runMigrations(TEST_DATABASE_URL);
}
