// SPDX-License-Identifier: AGPL-3.0-or-later
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { healthResponseSchema } from "@pasalista/core";
import type { Database } from "@pasalista/db";
import { sql } from "drizzle-orm";
import type { AppEnv } from "../types.ts";

const healthRoute = createRoute({
  method: "get",
  path: "/health",
  tags: ["system"],
  summary: "Liveness and database connectivity",
  responses: {
    200: { description: "API and database are healthy", content: { "application/json": { schema: healthResponseSchema } } },
    503: { description: "Database is unavailable", content: { "application/json": { schema: healthResponseSchema } } },
  },
});

const DB_TIMEOUT_MS = 2_000;

async function databaseIsUp(db: Database): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), DB_TIMEOUT_MS);
  });
  const query = db.execute(sql`select 1`).then(
    () => true,
    () => false,
  );
  try {
    return await Promise.race([query, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export function healthRoutes(deps: { db: Database; version: string }) {
  return new OpenAPIHono<AppEnv>().openapi(healthRoute, async (c) => {
    const up = await databaseIsUp(deps.db);
    const body = { status: up ? "ok" : "degraded", database: up ? "ok" : "unavailable", version: deps.version } as const;
    return up ? c.json(body, 200) : c.json(body, 503);
  });
}
