// SPDX-License-Identifier: AGPL-3.0-or-later
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
  attendeeListQuerySchema,
  attendeeListSchema,
  eventInputSchema,
  eventSchema,
  eventUpdateSchema,
  guestInputSchema,
  importReportSchema,
  importRequestSchema,
  purgeEventInputSchema,
  sendInvitationsResultSchema,
  staffInviteInputSchema,
  staffOverviewSchema,
} from "@pasalista/core";
import type { Auth } from "../auth.ts";
import { requireUser } from "../middleware/require-user.ts";
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
import {
  addGuest,
  cancelRegistration,
  importGuests,
  listGuests,
  reissueTicket,
  resendTicket,
  revokeTicket,
  sendPendingInvitations,
} from "../services/guests.ts";
import { purgeEventData } from "../services/purge.ts";
import { getStaff, inviteStaff, removeStaff, revokeStaffInvitation } from "../services/staff.ts";
import type { RateLimitStore } from "../middleware/rate-limit.ts";
import type { AuthedEnv } from "../types.ts";
import { registerCheckInRoutes } from "./checkins.ts";
import { pickErrors, validationHook } from "./openapi.ts";

const tags = ["events"];
const eventParams = z.object({ eventId: z.uuid() });
const json = <T extends z.ZodType>(schema: T) => ({ "application/json": { schema } });
const done = { 204: { description: "Done" } } as const;

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
    responses: { ...done, ...pickErrors(401, 404, 409) },
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
  purge: createRoute({
    method: "post",
    path: "/{eventId}/purge",
    tags,
    summary: "Irreversibly delete the personal data of a closed event (owners and admins)",
    request: {
      params: eventParams,
      body: { content: json(purgeEventInputSchema), required: true },
    },
    responses: {
      200: { description: "Purged; only totals remain", content: json(eventSchema) },
      ...pickErrors(400, 401, 403, 404, 409),
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
    tags: ["attendees"],
    summary: "Guest list with search, filters and pagination",
    request: { params: eventParams, query: attendeeListQuerySchema },
    responses: {
      200: { description: "Attendees", content: json(attendeeListSchema) },
      ...pickErrors(400, 401, 404),
    },
  }),
  addGuest: createRoute({
    method: "post",
    path: "/{eventId}/attendees",
    tags: ["attendees"],
    summary: "Add one guest (not emailed until invitations are sent)",
    request: { params: eventParams, body: { content: json(guestInputSchema), required: true } },
    responses: { 201: { description: "Added" }, ...pickErrors(400, 401, 404, 409) },
  }),
  importGuests: createRoute({
    method: "post",
    path: "/{eventId}/attendees/import",
    tags: ["attendees"],
    summary: "Import up to 2,000 guests; invalid rows are reported, valid ones added",
    request: { params: eventParams, body: { content: json(importRequestSchema), required: true } },
    responses: {
      200: { description: "Import report", content: json(importReportSchema) },
      ...pickErrors(400, 401, 404, 409),
    },
  }),
  sendInvitations: createRoute({
    method: "post",
    path: "/{eventId}/invitations/send",
    tags: ["attendees"],
    summary: "Issue tickets for every pending guest and queue their emails",
    request: { params: eventParams },
    responses: {
      200: { description: "Queued", content: json(sendInvitationsResultSchema) },
      ...pickErrors(401, 404, 409),
    },
  }),
  staff: createRoute({
    method: "get",
    path: "/{eventId}/staff",
    tags: ["staff"],
    request: { params: eventParams },
    responses: {
      200: { description: "Staff and pending invitations", content: json(staffOverviewSchema) },
      ...pickErrors(401, 404),
    },
  }),
  inviteStaff: createRoute({
    method: "post",
    path: "/{eventId}/staff/invitations",
    tags: ["staff"],
    summary: "Email a staff invitation (valid 7 days, only for that email)",
    request: {
      params: eventParams,
      body: { content: json(staffInviteInputSchema), required: true },
    },
    responses: { ...done, ...pickErrors(400, 401, 404, 409) },
  }),
  revokeStaffInvitation: createRoute({
    method: "delete",
    path: "/{eventId}/staff/invitations/{invitationId}",
    tags: ["staff"],
    request: { params: eventParams.extend({ invitationId: z.uuid() }) },
    responses: { ...done, ...pickErrors(401, 404) },
  }),
  removeStaff: createRoute({
    method: "delete",
    path: "/{eventId}/staff/{userId}",
    tags: ["staff"],
    request: { params: eventParams.extend({ userId: z.uuid() }) },
    responses: { ...done, ...pickErrors(401, 404) },
  }),
};

export function eventRoutes(
  deps: ServiceDeps,
  auth: Auth,
  rateLimits: { store: RateLimitStore; enabled: boolean },
) {
  const app = new OpenAPIHono<AuthedEnv>({ defaultHook: validationHook });
  app.use("*", requireUser(auth));
  registerCheckInRoutes(app, deps, rateLimits);
  const userId = (c: { get(key: "user"): { id: string } }) => c.get("user").id;

  return app
    .openapi(routes.list, async (c) => {
      const organizationId = await resolveOrganization(
        deps.db,
        userId(c),
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
      c.json(await getEvent(deps, userId(c), c.req.valid("param").eventId), 200),
    )
    .openapi(routes.update, async (c) =>
      c.json(
        await updateEvent(deps, userId(c), c.req.valid("param").eventId, c.req.valid("json")),
        200,
      ),
    )
    .openapi(routes.remove, async (c) => {
      await deleteDraftEvent(deps, userId(c), c.req.valid("param").eventId);
      return c.body(null, 204);
    })
    .openapi(routes.publish, async (c) =>
      c.json(
        await changeEventStatus(deps, userId(c), c.req.valid("param").eventId, "publish"),
        200,
      ),
    )
    .openapi(routes.close, async (c) =>
      c.json(await changeEventStatus(deps, userId(c), c.req.valid("param").eventId, "close"), 200),
    )
    .openapi(routes.purge, async (c) =>
      c.json(
        await purgeEventData(
          deps,
          userId(c),
          c.req.valid("param").eventId,
          c.req.valid("json").confirmSlug,
        ),
        200,
      ),
    )
    .openapi(routes.rotateKey, async (c) =>
      c.json({ version: await rotateEventKey(deps, userId(c), c.req.valid("param").eventId) }, 200),
    )
    .openapi(routes.attendees, async (c) =>
      c.json(
        await listGuests(deps, userId(c), c.req.valid("param").eventId, c.req.valid("query")),
        200,
      ),
    )
    .openapi(routes.addGuest, async (c) => {
      await addGuest(deps, userId(c), c.req.valid("param").eventId, c.req.valid("json"));
      return c.body(null, 201);
    })
    .openapi(routes.importGuests, async (c) =>
      c.json(
        await importGuests(deps, userId(c), c.req.valid("param").eventId, c.req.valid("json")),
        200,
      ),
    )
    .openapi(routes.sendInvitations, async (c) =>
      c.json(
        { sent: await sendPendingInvitations(deps, userId(c), c.req.valid("param").eventId) },
        200,
      ),
    )
    .openapi(routes.staff, async (c) =>
      c.json(await getStaff(deps, userId(c), c.req.valid("param").eventId), 200),
    )
    .openapi(routes.inviteStaff, async (c) => {
      await inviteStaff(deps, c.get("user"), c.req.valid("param").eventId, c.req.valid("json"));
      return c.body(null, 204);
    })
    .openapi(routes.revokeStaffInvitation, async (c) => {
      const { eventId, invitationId } = c.req.valid("param");
      await revokeStaffInvitation(deps, userId(c), eventId, invitationId);
      return c.body(null, 204);
    })
    .openapi(routes.removeStaff, async (c) => {
      const params = c.req.valid("param");
      await removeStaff(deps, userId(c), params.eventId, params.userId);
      return c.body(null, 204);
    });
}

const attendeeAction = (path: string, summary: string) =>
  createRoute({
    method: "post",
    path,
    tags: ["attendees"],
    summary,
    request: { params: z.object({ attendeeId: z.uuid() }) },
    responses: { ...done, ...pickErrors(401, 404, 409) },
  });

export function attendeeRoutes(deps: ServiceDeps, auth: Auth) {
  const app = new OpenAPIHono<AuthedEnv>({ defaultHook: validationHook });
  app.use("*", requireUser(auth));

  const actions = [
    [
      "/{attendeeId}/ticket/reissue",
      "Send a new ticket (new QR and link); also sends a pending invitation",
      reissueTicket,
    ],
    [
      "/{attendeeId}/ticket/resend",
      "Email the current ticket again (same QR, new link)",
      resendTicket,
    ],
    ["/{attendeeId}/ticket/revoke", "Invalidate the attendee's current QR", revokeTicket],
    ["/{attendeeId}/cancel", "Cancel the registration and revoke its ticket", cancelRegistration],
  ] as const;

  for (const [path, summary, action] of actions) {
    app.openapi(attendeeAction(path, summary), async (c) => {
      await action(deps, c.get("user").id, c.req.valid("param").attendeeId);
      return c.body(null, 204);
    });
  }
  return app;
}
