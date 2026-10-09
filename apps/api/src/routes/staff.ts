// SPDX-License-Identifier: AGPL-3.0-or-later
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { assignedEventSchema, staffInvitationPreviewSchema } from "@pasalista/core";
import type { Auth } from "../auth.ts";
import { rateLimit, type RateLimitStore } from "../middleware/rate-limit.ts";
import { requireUser } from "../middleware/require-user.ts";
import type { ServiceDeps } from "../services/context.ts";
import {
  acceptStaffInvitation,
  assignedEvents,
  previewStaffInvitation,
} from "../services/staff.ts";
import type { AuthedEnv } from "../types.ts";
import { pickErrors, validationHook } from "./openapi.ts";

const tags = ["staff"];
const tokenParams = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });
const json = <T extends z.ZodType>(schema: T) => ({ "application/json": { schema } });

const routes = {
  preview: createRoute({
    method: "get",
    path: "/{token}",
    tags,
    summary: "Staff invitation details (public, for the invitation page)",
    request: { params: tokenParams },
    responses: {
      200: { description: "Invitation", content: json(staffInvitationPreviewSchema) },
      ...pickErrors(404, 429),
    },
  }),
  accept: createRoute({
    method: "post",
    path: "/{token}/accept",
    tags,
    summary: "Accept with the signed-in account (must be the invited, verified email)",
    request: { params: tokenParams },
    responses: {
      200: { description: "Accepted", content: json(z.object({ eventId: z.uuid() })) },
      ...pickErrors(401, 403, 404, 409, 429),
    },
  }),
  assigned: createRoute({
    method: "get",
    path: "/staff-events",
    tags,
    summary: "Events where the signed-in user is staff",
    responses: {
      200: { description: "Events", content: json(z.array(assignedEventSchema)) },
      ...pickErrors(401),
    },
  }),
};

export function staffInvitationRoutes(
  deps: ServiceDeps,
  auth: Auth,
  options: { store: RateLimitStore; enabled: boolean },
) {
  const app = new OpenAPIHono<AuthedEnv>({ defaultHook: validationHook });
  app.use("*", rateLimit({ name: "staff-invitation", windowMs: 60_000, max: 30, ...options }));
  // Only accepting needs a session; the preview is public (the page shows who is invited).
  app.use("/:token/accept", requireUser(auth));
  return app
    .openapi(routes.preview, async (c) =>
      c.json(await previewStaffInvitation(deps, c.req.valid("param").token), 200),
    )
    .openapi(routes.accept, async (c) =>
      c.json(await acceptStaffInvitation(deps, c.get("user"), c.req.valid("param").token), 200),
    );
}

/** Routes about the signed-in user, mounted at /api/v1/me. */
export function meRoutes(deps: ServiceDeps, auth: Auth) {
  const app = new OpenAPIHono<AuthedEnv>({ defaultHook: validationHook });
  app.use("*", requireUser(auth));
  return app.openapi(routes.assigned, async (c) =>
    c.json(await assignedEvents(deps, c.get("user").id), 200),
  );
}
