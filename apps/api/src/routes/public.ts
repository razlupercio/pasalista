// SPDX-License-Identifier: AGPL-3.0-or-later
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
  publicEventSchema,
  registrationInputSchema,
  registrationResultSchema,
  ticketViewSchema,
} from "@pasalista/core";
import { ticketQrPng } from "../email/templates.ts";
import { rateLimit, type RateLimitStore } from "../middleware/rate-limit.ts";
import {
  cancelOwnRegistration,
  getPublicEvent,
  registerAttendee,
  ticketQrToken,
  viewTicket,
} from "../services/attendees.ts";
import type { ServiceDeps } from "../services/context.ts";
import type { AppEnv } from "../types.ts";
import { pickErrors, validationHook } from "./openapi.ts";

const tags = ["public"];
const slugParams = z.object({ slug: z.string().regex(/^[a-z0-9-]{1,64}$/) });
const ticketParams = z.object({ accessToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });
const json = <T extends z.ZodType>(schema: T) => ({ "application/json": { schema } });

const routes = {
  event: createRoute({
    method: "get",
    path: "/events/{slug}",
    tags,
    summary: "Public event page data (published and closed events only)",
    request: { params: slugParams },
    responses: {
      200: { description: "Event", content: json(publicEventSchema) },
      ...pickErrors(404),
    },
  }),
  register: createRoute({
    method: "post",
    path: "/events/{slug}/registrations",
    tags,
    summary: "Open registration; the ticket is emailed",
    request: {
      params: slugParams,
      body: { content: json(registrationInputSchema), required: true },
    },
    responses: {
      201: { description: "Registered", content: json(registrationResultSchema) },
      ...pickErrors(400, 403, 404, 409, 429),
    },
  }),
  ticket: createRoute({
    method: "get",
    path: "/tickets/{accessToken}",
    tags,
    summary: "The attendee's ticket, reached through the secret link",
    request: { params: ticketParams },
    responses: {
      200: { description: "Ticket", content: json(ticketViewSchema) },
      ...pickErrors(404, 429),
    },
  }),
  ticketQr: createRoute({
    method: "get",
    path: "/tickets/{accessToken}/qr.png",
    tags,
    summary: "QR code image of a valid ticket",
    request: { params: ticketParams, query: z.object({ download: z.enum(["1"]).optional() }) },
    responses: {
      200: {
        description: "PNG image",
        content: { "image/png": { schema: z.string().meta({ format: "binary" }) } },
      },
      ...pickErrors(404, 429),
    },
  }),
  cancel: createRoute({
    method: "post",
    path: "/tickets/{accessToken}/cancel",
    tags,
    summary: "The attendee cancels their own registration",
    request: { params: ticketParams },
    responses: { 204: { description: "Cancelled" }, ...pickErrors(404, 429) },
  }),
};

export function publicRoutes(
  deps: ServiceDeps,
  options: { store: RateLimitStore; enabled: boolean },
) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  app.on(
    "POST",
    "/events/:slug/registrations",
    rateLimit({ name: "registration", windowMs: 60_000, max: 10, ...options }),
  );
  app.use("/tickets/*", rateLimit({ name: "ticket", windowMs: 60_000, max: 60, ...options }));

  return app
    .openapi(routes.event, async (c) =>
      c.json(await getPublicEvent(deps, c.req.valid("param").slug), 200),
    )
    .openapi(routes.register, async (c) => {
      await registerAttendee(deps, c.req.valid("param").slug, c.req.valid("json"));
      return c.json({ status: "registered" as const }, 201);
    })
    .openapi(routes.ticket, async (c) => {
      c.header("Referrer-Policy", "no-referrer");
      return c.json(await viewTicket(deps, c.req.valid("param").accessToken), 200);
    })
    .openapi(routes.ticketQr, async (c) => {
      const { token, slug } = await ticketQrToken(deps, c.req.valid("param").accessToken);
      const png = await ticketQrPng(token);
      const disposition = c.req.valid("query").download
        ? `attachment; filename="ticket-${slug}.png"`
        : "inline";
      return c.body(new Uint8Array(png), 200, {
        "Content-Type": "image/png",
        "Content-Disposition": disposition,
      });
    })
    .openapi(routes.cancel, async (c) => {
      await cancelOwnRegistration(deps, c.req.valid("param").accessToken);
      return c.body(null, 204);
    });
}
