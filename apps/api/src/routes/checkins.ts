// SPDX-License-Identifier: AGPL-3.0-or-later
import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import {
  checkInRequestSchema,
  checkInResultSchema,
  eventStatsSchema,
  scanContextSchema,
  scanSearchQuerySchema,
  scanSearchResultSchema,
} from "@pasalista/core";
import { etag } from "hono/etag";
import { rateLimit, type RateLimitStore } from "../middleware/rate-limit.ts";
import {
  checkIn,
  eventStats,
  exportAttendeesCsv,
  scanContext,
  searchForScan,
  undoCheckIn,
} from "../services/checkins.ts";
import type { ServiceDeps } from "../services/context.ts";
import type { AuthedEnv } from "../types.ts";
import { pickErrors } from "./openapi.ts";

const tags = ["check-in"];
const eventParams = z.object({ eventId: z.uuid() });
const json = <T extends z.ZodType>(schema: T) => ({ "application/json": { schema } });

const routes = {
  context: createRoute({
    method: "get",
    path: "/{eventId}/scan-context",
    tags,
    summary: "What the scanner needs: event, check-in window, counts (organizers and staff)",
    request: { params: eventParams },
    responses: {
      200: { description: "Scan context", content: json(scanContextSchema) },
      ...pickErrors(401, 404),
    },
  }),
  checkIn: createRoute({
    method: "post",
    path: "/{eventId}/check-ins",
    tags,
    summary: "Check in by QR token or attendee id; idempotent per clientCheckInId",
    description:
      "Business outcomes (valid, already_used, invalid, wrong_event, revoked, outside_window) are 200 responses so scanners can show them directly.",
    request: { params: eventParams, body: { content: json(checkInRequestSchema), required: true } },
    responses: {
      200: { description: "Outcome", content: json(checkInResultSchema) },
      ...pickErrors(400, 401, 404, 429),
    },
  }),
  search: createRoute({
    method: "get",
    path: "/{eventId}/scan-search",
    tags,
    summary: "Manual check-in search (name or email; partial emails only)",
    request: { params: eventParams, query: scanSearchQuerySchema },
    responses: {
      200: { description: "Matches", content: json(scanSearchResultSchema) },
      ...pickErrors(400, 401, 404, 429),
    },
  }),
  undo: createRoute({
    method: "delete",
    path: "/{eventId}/check-ins/{attendeeId}",
    tags,
    summary: "Undo a mistaken check-in (organizers only, audited)",
    request: { params: eventParams.extend({ attendeeId: z.uuid() }) },
    responses: { 204: { description: "Undone" }, ...pickErrors(401, 404) },
  }),
  stats: createRoute({
    method: "get",
    path: "/{eventId}/stats",
    tags,
    summary: "Live dashboard numbers; supports If-None-Match for cheap polling",
    request: { params: eventParams },
    responses: {
      200: { description: "Stats", content: json(eventStatsSchema) },
      304: { description: "Not modified" },
      ...pickErrors(401, 404),
    },
  }),
  exportCsv: createRoute({
    method: "get",
    path: "/{eventId}/export.csv",
    tags,
    summary: "Guest list with check-in times as CSV (organizers only)",
    request: { params: eventParams },
    responses: {
      200: { description: "CSV file", content: { "text/csv": { schema: z.string() } } },
      ...pickErrors(401, 404),
    },
  }),
};

/** Registers scanner and dashboard routes on the (already authenticated) events app. */
export function registerCheckInRoutes(
  app: OpenAPIHono<AuthedEnv>,
  deps: ServiceDeps,
  options: { store: RateLimitStore; enabled: boolean },
) {
  // Generous: a busy entrance scans a few people per second per device.
  app.on(
    "POST",
    "/:eventId/check-ins",
    rateLimit({ name: "check-in", windowMs: 60_000, max: 240, ...options }),
  );
  app.use(
    "/:eventId/scan-search",
    rateLimit({ name: "scan-search", windowMs: 60_000, max: 60, ...options }),
  );
  app.use("/:eventId/stats", etag({ weak: true }));

  app.openapi(routes.context, async (c) =>
    c.json(await scanContext(deps, c.get("user").id, c.req.valid("param").eventId), 200),
  );
  app.openapi(routes.checkIn, async (c) =>
    c.json(
      await checkIn(deps, c.get("user"), c.req.valid("param").eventId, c.req.valid("json")),
      200,
    ),
  );
  app.openapi(routes.search, async (c) =>
    c.json(
      await searchForScan(
        deps,
        c.get("user").id,
        c.req.valid("param").eventId,
        c.req.valid("query").q,
      ),
      200,
    ),
  );
  app.openapi(routes.undo, async (c) => {
    const { eventId, attendeeId } = c.req.valid("param");
    await undoCheckIn(deps, c.get("user").id, eventId, attendeeId);
    return c.body(null, 204);
  });
  app.openapi(routes.stats, async (c) =>
    c.json(await eventStats(deps, c.get("user").id, c.req.valid("param").eventId), 200),
  );
  app.openapi(routes.exportCsv, async (c) => {
    const { filename, csv } = await exportAttendeesCsv(
      deps,
      c.get("user").id,
      c.req.valid("param").eventId,
    );
    return c.body(csv, 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    });
  });
}
