// SPDX-License-Identifier: AGPL-3.0-or-later
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { attendeeSchema, eventInputSchema, eventSchema, eventUpdateSchema } from "@pasalista/core";
import type { Auth } from "../auth.ts";
import { requireUser } from "../middleware/require-user.ts";
import {
  cancelRegistration,
  listAttendees,
  reissueTicket,
  revokeTicket,
} from "../services/attendees.ts";
import type { ServiceDeps } from "../services/context.ts";
import {
  changeEventStatus,
  createEvent,
  deleteDraftEvent,
  getEvent,
  listEvents,
  resolveOrganization,
  rotateEventKey,
  updateEvent,
} from "../services/events.ts";
import type { AuthedEnv } from "../types.ts";
import { pickErrors, validationHook } from "./openapi.ts";

const tags = ["events"];
const eventParams = z.object({ eventId: z.uuid() });
const attendeeParams = z.object({ attendeeId: z.uuid() });
const json = <T extends z.ZodType>(schema: T) => ({ "application/json": { schema } });

const routes = {
  list: createRoute({
    method: "get",
    path: "/",
    tags,
    summary: "Events of the active organization",
    responses: {
      200: { description: "Events", content: json(z.array(eventSchema)) },
      ...pickErrors(401),
    },
  }),
  create: createRoute({
    method: "post",
    path: "/",
    tags,
    summary: "Create a draft event (generates its first signing key)",
    request: { body: { content: json(eventInputSchema), required: true } },
    responses: {
      201: { description: "Created", content: json(eventSchema) },
      ...pickErrors(400, 401, 403),
    },
  }),
  get: createRoute({
    method: "get",
    path: "/{eventId}",
    tags,
    request: { params: eventParams },
    responses: {
      200: { description: "Event", content: json(eventSchema) },
      ...pickErrors(401, 404),
    },
  }),
  update: createRoute({
    method: "patch",
    path: "/{eventId}",
    tags,
    summary: "Edit an event (allowed in any status)",
    request: { params: eventParams, body: { content: json(eventUpdateSchema), required: true } },
    responses: {
      200: { description: "Updated", content: json(eventSchema) },
      ...pickErrors(400, 401, 404),
    },
  }),
  remove: createRoute({
    method: "delete",
    path: "/{eventId}",
    tags,
    summary: "Delete a draft event",
    request: { params: eventParams },
    responses: { 204: { description: "Deleted" }, ...pickErrors(401, 404, 409) },
  }),
  publish: createRoute({
    method: "post",
    path: "/{eventId}/publish",
    tags,
    request: { params: eventParams },
    responses: {
      200: { description: "Published", content: json(eventSchema) },
      ...pickErrors(401, 404, 409),
    },
  }),
  close: createRoute({
    method: "post",
    path: "/{eventId}/close",
    tags,
    request: { params: eventParams },
    responses: {
      200: { description: "Closed", content: json(eventSchema) },
      ...pickErrors(401, 404, 409),
    },
  }),
  rotateKey: createRoute({
    method: "post",
    path: "/{eventId}/signing-keys/rotate",
    tags,
    summary: "Rotate the event signing key; existing tickets stay valid",
    request: { params: eventParams },
    responses: {
      200: {
        description: "New active key version",
        content: json(z.object({ version: z.number().int() })),
      },
      ...pickErrors(401, 404),
    },
  }),
  attendees: createRoute({
    method: "get",
    path: "/{eventId}/attendees",
    tags,
    request: { params: eventParams },
    responses: {
      200: { description: "Attendees", content: json(z.array(attendeeSchema)) },
      ...pickErrors(401, 404),
    },
  }),
};

export function eventRoutes(deps: ServiceDeps, auth: Auth) {
  const app = new OpenAPIHono<AuthedEnv>({ defaultHook: validationHook });
  app.use("*", requireUser(auth));

  return app
    .openapi(routes.list, async (c) => {
      const organizationId = await resolveOrganization(
        deps.db,
        c.get("user").id,
        c.get("activeOrganizationId"),
      );
      return c.json(await listEvents(deps.db, organizationId), 200);
    })
    .openapi(routes.create, async (c) => {
      const user = c.get("user");
      const organizationId = await resolveOrganization(
        deps.db,
        user.id,
        c.get("activeOrganizationId"),
      );
      return c.json(await createEvent(deps, user, organizationId, c.req.valid("json")), 201);
    })
    .openapi(routes.get, async (c) =>
      c.json(await getEvent(deps, c.get("user").id, c.req.valid("param").eventId), 200),
    )
    .openapi(routes.update, async (c) =>
      c.json(
        await updateEvent(
          deps,
          c.get("user").id,
          c.req.valid("param").eventId,
          c.req.valid("json"),
        ),
        200,
      ),
    )
    .openapi(routes.remove, async (c) => {
      await deleteDraftEvent(deps, c.get("user").id, c.req.valid("param").eventId);
      return c.body(null, 204);
    })
    .openapi(routes.publish, async (c) =>
      c.json(
        await changeEventStatus(deps, c.get("user").id, c.req.valid("param").eventId, "publish"),
        200,
      ),
    )
    .openapi(routes.close, async (c) =>
      c.json(
        await changeEventStatus(deps, c.get("user").id, c.req.valid("param").eventId, "close"),
        200,
      ),
    )
    .openapi(routes.rotateKey, async (c) =>
      c.json(
        { version: await rotateEventKey(deps, c.get("user").id, c.req.valid("param").eventId) },
        200,
      ),
    )
    .openapi(routes.attendees, async (c) =>
      c.json(await listAttendees(deps, c.get("user").id, c.req.valid("param").eventId), 200),
    );
}

const attendeeTags = ["attendees"];
const attendeeAction = (path: string, summary: string) =>
  createRoute({
    method: "post",
    path,
    tags: attendeeTags,
    summary,
    request: { params: attendeeParams },
    responses: { 204: { description: "Done" }, ...pickErrors(401, 404, 409) },
  });

export function attendeeRoutes(deps: ServiceDeps, auth: Auth) {
  const app = new OpenAPIHono<AuthedEnv>({ defaultHook: validationHook });
  app.use("*", requireUser(auth));

  return app
    .openapi(
      attendeeAction(
        "/{attendeeId}/ticket/reissue",
        "Issue a new QR and link, emailed to the attendee",
      ),
      async (c) => {
        await reissueTicket(deps, c.get("user").id, c.req.valid("param").attendeeId);
        return c.body(null, 204);
      },
    )
    .openapi(
      attendeeAction("/{attendeeId}/ticket/revoke", "Invalidate the attendee's current QR"),
      async (c) => {
        await revokeTicket(deps, c.get("user").id, c.req.valid("param").attendeeId);
        return c.body(null, 204);
      },
    )
    .openapi(
      attendeeAction("/{attendeeId}/cancel", "Cancel the registration and revoke its ticket"),
      async (c) => {
        await cancelRegistration(deps, c.get("user").id, c.req.valid("param").attendeeId);
        return c.body(null, 204);
      },
    );
}
