// SPDX-License-Identifier: AGPL-3.0-or-later
// Writes apps/api/openapi.json from the route definitions. CI fails if the committed file is stale.
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createDb } from "@pasalista/db";
import { createApp, OPENAPI_PATH } from "../app.ts";
import { createAuth } from "../auth.ts";
import { loadEnv } from "../env.ts";
import { createLogger } from "../logger.ts";

const env = loadEnv({ NODE_ENV: "development", APP_VERSION: process.env.APP_VERSION });
const { db, pool } = createDb(env.DATABASE_URL); // never connects: generation does not query
const app = createApp({ env, db, auth: createAuth({ db, env }), logger: createLogger("silent") });

const response = await app.request(OPENAPI_PATH);
const document: unknown = await response.json();
const target = fileURLToPath(new URL("../../openapi.json", import.meta.url));
await writeFile(target, `${JSON.stringify(document, null, 2)}\n`);
await pool.end();
console.log(`OpenAPI document written to ${target}`);
