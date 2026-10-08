// SPDX-License-Identifier: AGPL-3.0-or-later
import { serve } from "@hono/node-server";
import { createDb } from "@pasalista/db";
import { createApp } from "./app.ts";
import { createAuth } from "./auth.ts";
import { startOutboxWorker } from "./email/outbox.ts";
import { createSmtpTransport } from "./email/transport.ts";
import { loadEnv } from "./env.ts";
import { createLogger } from "./logger.ts";

const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL);
const { db, pool } = createDb(env.DATABASE_URL);
const auth = createAuth({ db, env });
const app = createApp({ env, db, auth, logger });

const worker = env.EMAIL_WORKER_ENABLED
  ? startOutboxWorker(db, createSmtpTransport(env), logger.child({ component: "email-worker" }))
  : undefined;

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  logger.info({ port: info.port, env: env.NODE_ENV }, "api listening");
});

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "shutting down");
  server.close();
  await worker?.stop();
  await pool.end();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
