// SPDX-License-Identifier: AGPL-3.0-or-later
import { uuidv7, type Event } from "@pasalista/core";
import { schema } from "@pasalista/db";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import {
  api,
  createPublishedEvent,
  createTestContext,
  latestEmail,
  newOrganizer,
  register,
  signUpAndVerify,
  uniqueEmail,
  type EventBody,
} from "./helpers.ts";

const ctx = createTestContext();
afterAll(() => ctx.close());

const soon = () => ({
  startsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  endsAt: null,
});

async function busyEvent() {
  const organizer = await newOrganizer(ctx);
  const event = await createPublishedEvent(ctx, organizer, soon());
  const emails = [uniqueEmail("a"), uniqueEmail("b")];
  for (const email of emails) await register(ctx, event.slug, { email });
  const token = String((await latestEmail(ctx, emails[0]!))!.payload.qrToken);
  await api(ctx, "POST", `/api/v1/events/${event.id}/check-ins`, {
    cookie: organizer,
    body: { method: "qr", token, clientCheckInId: uuidv7(), deviceId: "test-device" },
  });
  await api(ctx, "POST", `/api/v1/events/${event.id}/check-ins`, {
    cookie: organizer,
    body: { method: "qr", token: "garbage", clientCheckInId: uuidv7(), deviceId: "test-device" },
  });
  await api(ctx, "POST", `/api/v1/events/${event.id}/staff/invitations`, {
    cookie: organizer,
    body: { email: uniqueEmail("staff"), locale: "es-MX" },
  });
  // A legacy outbox row without event id (queued before the column existed).
  await ctx.db.insert(schema.emailOutbox).values({
    kind: "magic_link",
    toEmail: emails[1]!,
    locale: "es-MX",
    organizationId: event.organizationId,
    payload: {},
  });
  return { organizer, event, emails };
}

const close = (cookie: string, event: EventBody) =>
  api(ctx, "POST", `/api/v1/events/${event.id}/close`, { cookie });
const purge = (cookie: string, event: EventBody, confirmSlug = event.slug) =>
  api<Event & { code?: string }>(ctx, "POST", `/api/v1/events/${event.id}/purge`, {
    cookie,
    body: { confirmSlug },
  });

async function rowsFor(eventId: string, emails: string[]) {
  const [attendees, tickets, checkIns, attempts, staff, invitations, keys, outbox] =
    await Promise.all([
      ctx.db.select().from(schema.attendees).where(eq(schema.attendees.eventId, eventId)),
      ctx.db.select().from(schema.tickets).where(eq(schema.tickets.eventId, eventId)),
      ctx.db.select().from(schema.checkIns).where(eq(schema.checkIns.eventId, eventId)),
      ctx.db
        .select()
        .from(schema.checkInAttempts)
        .where(eq(schema.checkInAttempts.eventId, eventId)),
      ctx.db.select().from(schema.eventStaff).where(eq(schema.eventStaff.eventId, eventId)),
      ctx.db
        .select()
        .from(schema.staffInvitations)
        .where(eq(schema.staffInvitations.eventId, eventId)),
      ctx.db
        .select()
        .from(schema.eventSigningKeys)
        .where(eq(schema.eventSigningKeys.eventId, eventId)),
      Promise.all(
        emails.map((e) =>
          ctx.db.select().from(schema.emailOutbox).where(eq(schema.emailOutbox.toEmail, e)),
        ),
      ),
    ]);
  return {
    attendees: attendees.length,
    tickets: tickets.length,
    checkIns: checkIns.length,
    attempts: attempts.length,
    staff: staff.length,
    invitations: invitations.length,
    keys: keys.length,
    outbox: outbox.flat().length,
  };
}

describe("event data purge", () => {
  it("removes every personal record and keeps only the totals", async () => {
    const { organizer, event, emails } = await busyEvent();
    const before = await rowsFor(event.id, emails);
    expect(before).toMatchObject({
      attendees: 2,
      checkIns: 1,
      attempts: 2,
      invitations: 1,
      outbox: 3,
    });

    await close(organizer, event);
    const purged = await purge(organizer, event);
    expect(purged.status).toBe(200);
    expect(purged.body).toMatchObject({ registeredCount: 2, checkedInCount: 1, status: "closed" });
    expect(purged.body.purgedAt).toBeTruthy();

    expect(await rowsFor(event.id, emails)).toEqual({
      attendees: 0,
      tickets: 0,
      checkIns: 0,
      attempts: 0,
      staff: 0,
      invitations: 0,
      keys: 0,
      outbox: 0,
    });

    const [log] = await ctx.db
      .select({ metadata: schema.auditLog.metadata })
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.action, "event.purge"), eq(schema.auditLog.eventId, event.id)));
    expect(log?.metadata).toEqual(
      expect.objectContaining({ registered: expect.any(Number) as number }),
    );
    expect(JSON.stringify(log)).not.toContain("@example.test");

    // Totals survive on the event itself.
    const again = await api<Event>(ctx, "GET", `/api/v1/events/${event.id}`, { cookie: organizer });
    expect(again.body).toMatchObject({ registeredCount: 2, checkedInCount: 1 });
    const page = await api<{ registrationState: string }>(
      ctx,
      "GET",
      `/api/v1/public/events/${event.slug}`,
      {
        cookie: null,
      },
    );
    expect(page.body.registrationState).toBe("closed");
  });

  it("leaves other events' data alone, even for the same email", async () => {
    const { organizer, event, emails } = await busyEvent();
    const other = await createPublishedEvent(ctx, organizer, soon());
    await register(ctx, other.slug, { email: emails[0]! });
    await close(organizer, event);
    await purge(organizer, event);
    const kept = await ctx.db
      .select()
      .from(schema.attendees)
      .where(eq(schema.attendees.eventId, other.id));
    expect(kept).toHaveLength(1);
    expect(await latestEmail(ctx, emails[0]!)).toMatchObject({ kind: "ticket", eventId: other.id });
  });

  it("makes the event read-only afterwards", async () => {
    const { organizer, event } = await busyEvent();
    await close(organizer, event);
    await purge(organizer, event);
    const attempts = await Promise.all([
      api(ctx, "POST", `/api/v1/events/${event.id}/publish`, { cookie: organizer }),
      api(ctx, "PATCH", `/api/v1/events/${event.id}`, {
        cookie: organizer,
        body: { name: "Again" },
      }),
      api(ctx, "POST", `/api/v1/events/${event.id}/attendees`, {
        cookie: organizer,
        body: { name: "X", email: uniqueEmail(), locale: "es-MX" },
      }),
      api(ctx, "POST", `/api/v1/events/${event.id}/signing-keys/rotate`, { cookie: organizer }),
      purge(organizer, event),
    ]);
    expect(attempts.map((a) => a.status)).toEqual([409, 409, 409, 409, 409]);
  });

  it("requires a closed event, the exact slug and an owner or admin", async () => {
    const { organizer, event } = await busyEvent();
    expect((await purge(organizer, event)).body.code).toBe("invalid_state"); // still published
    await close(organizer, event);
    expect((await purge(organizer, event, "wrong-slug")).status).toBe(400);

    const member = await signUpAndVerify(ctx, uniqueEmail("member"));
    const session = await api<{ user: { id: string } }>(ctx, "GET", "/api/v1/auth/get-session", {
      cookie: member,
    });
    await ctx.db
      .insert(schema.organizationMembers)
      .values({
        organizationId: event.organizationId,
        userId: session.body.user.id,
        role: "member",
      });
    expect((await purge(member, event)).status).toBe(403);

    const stranger = await newOrganizer(ctx);
    expect((await purge(stranger, event)).status).toBe(404);
    expect((await rowsFor(event.id, [])).attendees).toBe(2);
  });
});
