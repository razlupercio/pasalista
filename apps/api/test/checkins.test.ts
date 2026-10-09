// SPDX-License-Identifier: AGPL-3.0-or-later
import { uuidv7, type CheckInResult, type EventStats } from "@pasalista/core";
import { schema } from "@pasalista/db";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import {
  api,
  createEvent,
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

/** Starts in one hour: inside the check-in window (opens 6 h before). */
const soon = () => ({
  startsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  endsAt: null,
});

async function openEvent(overrides: Record<string, unknown> = {}) {
  const organizer = await newOrganizer(ctx);
  const event = await createPublishedEvent(ctx, organizer, { ...soon(), ...overrides });
  return { organizer, event };
}

async function guestWithTicket(event: EventBody, name = "Sam Doe") {
  const email = uniqueEmail("guest");
  await register(ctx, event.slug, { email, name });
  const mail = await latestEmail(ctx, email);
  const [attendee] = await ctx.db
    .select()
    .from(schema.attendees)
    .where(eq(schema.attendees.email, email));
  return { email, token: String(mail!.payload.qrToken), attendee: attendee! };
}

function scan(cookie: string, eventId: string, token: string, clientCheckInId = uuidv7()) {
  return api<CheckInResult & { code?: string }>(
    ctx,
    "POST",
    `/api/v1/events/${eventId}/check-ins`,
    {
      cookie,
      body: { method: "qr", token, clientCheckInId, deviceId: "test-device" },
    },
  );
}

async function staffFor(organizer: string, eventId: string) {
  const email = uniqueEmail("staff");
  await api(ctx, "POST", `/api/v1/events/${eventId}/staff/invitations`, {
    cookie: organizer,
    body: { email, locale: "es-MX" },
  });
  const token = new URL(String((await latestEmail(ctx, email))!.payload.url)).pathname
    .split("/")
    .at(-1)!;
  const cookie = await signUpAndVerify(ctx, email);
  await api(ctx, "POST", `/api/v1/staff-invitations/${token}/accept`, { cookie });
  return cookie;
}

describe("QR check-in", () => {
  it("accepts a valid ticket once and reports the first check-in time afterwards", async () => {
    const { organizer, event } = await openEvent();
    const { token, attendee } = await guestWithTicket(event);

    const first = await scan(organizer, event.id, token);
    expect(first.body).toMatchObject({
      outcome: "valid",
      attendee: { id: attendee.id, name: "Sam Doe" },
      counts: { checkedIn: 1, registered: 1 },
    });
    const second = await scan(organizer, event.id, token);
    expect(second.body.outcome).toBe("already_used");
    expect(second.body.checkedInAt).toBe(first.body.checkedInAt);

    const attempts = await ctx.db
      .select({ outcome: schema.checkInAttempts.outcome })
      .from(schema.checkInAttempts)
      .where(eq(schema.checkInAttempts.eventId, event.id));
    expect(attempts.map((a) => a.outcome).sort()).toEqual(["already_used", "valid"]);
  });

  it("creates exactly one check-in when the same QR is scanned concurrently", async () => {
    const { organizer, event } = await openEvent();
    const { token, attendee } = await guestWithTicket(event);
    const results = await Promise.all(
      Array.from({ length: 12 }, () => scan(organizer, event.id, token)),
    );
    const outcomes = results.map((r) => r.body.outcome);
    expect(outcomes.filter((o) => o === "valid")).toHaveLength(1);
    expect(outcomes.filter((o) => o === "already_used")).toHaveLength(11);
    const rows = await ctx.db
      .select()
      .from(schema.checkIns)
      .where(
        and(eq(schema.checkIns.eventId, event.id), eq(schema.checkIns.attendeeId, attendee.id)),
      );
    expect(rows).toHaveLength(1);
  });

  it("answers a retried request (same client id) like the first one", async () => {
    const { organizer, event } = await openEvent();
    const { token } = await guestWithTicket(event);
    const id = uuidv7();
    const [a, b] = await Promise.all([
      scan(organizer, event.id, token, id),
      scan(organizer, event.id, token, id),
    ]);
    expect([a.body.outcome, b.body.outcome]).toEqual(["valid", "valid"]);
    expect((await scan(organizer, event.id, token, id)).body.outcome).toBe("valid");
  });

  it("rejects tokens for another event, forged tokens and garbage", async () => {
    const { organizer, event } = await openEvent();
    const other = await createPublishedEvent(ctx, organizer, soon());
    const { token } = await guestWithTicket(other);
    expect((await scan(organizer, event.id, token)).body.outcome).toBe("wrong_event");

    const forged = token.slice(0, -4) + (token.endsWith("AAAA") ? "BBBB" : "AAAA");
    expect((await scan(organizer, other.id, forged)).body.outcome).toBe("invalid");
    expect((await scan(organizer, event.id, "https://example.com")).body.outcome).toBe("invalid");
  });

  it("rejects reissued (old QR), revoked and cancelled tickets", async () => {
    const { organizer, event } = await openEvent();
    const reissued = await guestWithTicket(event);
    await api(ctx, "POST", `/api/v1/attendees/${reissued.attendee.id}/ticket/reissue`, {
      cookie: organizer,
    });
    expect((await scan(organizer, event.id, reissued.token)).body.outcome).toBe("revoked");

    const revoked = await guestWithTicket(event);
    await api(ctx, "POST", `/api/v1/attendees/${revoked.attendee.id}/ticket/revoke`, {
      cookie: organizer,
    });
    expect((await scan(organizer, event.id, revoked.token)).body.outcome).toBe("revoked");

    const cancelled = await guestWithTicket(event);
    await api(ctx, "POST", `/api/v1/attendees/${cancelled.attendee.id}/cancel`, {
      cookie: organizer,
    });
    expect((await scan(organizer, event.id, cancelled.token)).body.outcome).toBe("revoked");
  });

  it("only scans inside the check-in window and never for drafts", async () => {
    const organizer = await newOrganizer(ctx);
    const later = await createPublishedEvent(ctx, organizer); // starts in 30 days
    const { token } = await guestWithTicket(later);
    expect((await scan(organizer, later.id, token)).body.outcome).toBe("outside_window");

    const draft = await createEvent(ctx, organizer, soon());
    expect((await scan(organizer, draft.id, token)).body.outcome).toBe("outside_window");
  });
});

describe("who can scan", () => {
  it("lets assigned staff scan but not manage, and keeps everyone else out", async () => {
    const { organizer, event } = await openEvent();
    const { token } = await guestWithTicket(event);
    const staff = await staffFor(organizer, event.id);

    const context = await api<{ role: string }>(
      ctx,
      "GET",
      `/api/v1/events/${event.id}/scan-context`,
      {
        cookie: staff,
      },
    );
    expect(context.body.role).toBe("staff");
    expect((await scan(staff, event.id, token)).body.outcome).toBe("valid");

    const [checkIn] = await ctx.db
      .select()
      .from(schema.checkIns)
      .where(eq(schema.checkIns.eventId, event.id));
    expect(
      (
        await api(ctx, "DELETE", `/api/v1/events/${event.id}/check-ins/${checkIn!.attendeeId}`, {
          cookie: staff,
        })
      ).status,
    ).toBe(404);
    expect(
      (await api(ctx, "GET", `/api/v1/events/${event.id}/stats`, { cookie: staff })).status,
    ).toBe(404);
    expect(
      (await api(ctx, "GET", `/api/v1/events/${event.id}/export.csv`, { cookie: staff })).status,
    ).toBe(404);

    const stranger = await newOrganizer(ctx);
    expect((await scan(stranger, event.id, token)).status).toBe(404);
    expect(
      (await api(ctx, "GET", `/api/v1/events/${event.id}/scan-context`, { cookie: stranger }))
        .status,
    ).toBe(404);
  });
});

describe("manual check-in", () => {
  it("finds guests with partial emails and checks them in by id", async () => {
    const { organizer, event } = await openEvent({ registrationMode: "closed" });
    await api(ctx, "POST", `/api/v1/events/${event.id}/attendees`, {
      cookie: organizer,
      body: { name: "María Pendiente", email: "maria.pendiente@example.test", locale: "es-MX" },
    });
    const staff = await staffFor(organizer, event.id);
    const results = await api<{ id: string; maskedEmail: string; checkedInAt: string | null }[]>(
      ctx,
      "GET",
      `/api/v1/events/${event.id}/scan-search?q=mar%C3%ADa`,
      { cookie: staff },
    );
    expect(results.body).toEqual([
      expect.objectContaining({ maskedEmail: "ma***@example.test", checkedInAt: null }),
    ]);
    expect(JSON.stringify(results.body)).not.toContain("maria.pendiente@");

    // A guest whose invitation was not sent yet may still enter.
    const manual = await api<CheckInResult>(ctx, "POST", `/api/v1/events/${event.id}/check-ins`, {
      cookie: staff,
      body: { method: "manual", attendeeId: results.body[0]!.id, clientCheckInId: uuidv7() },
    });
    expect(manual.body.outcome).toBe("valid");
    expect(
      (await api(ctx, "GET", `/api/v1/events/${event.id}/scan-search?q=x`, { cookie: staff }))
        .status,
    ).toBe(400);
  });
});

describe("organizer tools", () => {
  it("undoes a check-in, recording it in the audit log", async () => {
    const { organizer, event } = await openEvent();
    const { token, attendee } = await guestWithTicket(event);
    await scan(organizer, event.id, token);
    const undo = await api(ctx, "DELETE", `/api/v1/events/${event.id}/check-ins/${attendee.id}`, {
      cookie: organizer,
    });
    expect(undo.status).toBe(204);
    expect((await scan(organizer, event.id, token)).body.outcome).toBe("valid");

    const log = await ctx.db
      .select({ action: schema.auditLog.action, entityId: schema.auditLog.entityId })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.eventId, event.id));
    expect(log).toEqual(
      expect.arrayContaining([
        { action: "event.publish", entityId: event.id },
        { action: "check_in.undo", entityId: attendee.id },
      ]),
    );
  });

  it("reports live stats and answers 304 when nothing changed", async () => {
    const { organizer, event } = await openEvent();
    const a = await guestWithTicket(event, "Alpha");
    await guestWithTicket(event, "Beta");
    await scan(organizer, event.id, a.token);
    await scan(organizer, event.id, a.token);
    await scan(organizer, event.id, "garbage");

    const stats = await api<EventStats>(ctx, "GET", `/api/v1/events/${event.id}/stats`, {
      cookie: organizer,
    });
    expect(stats.body).toMatchObject({
      registered: 2,
      checkedIn: 1,
      notCheckedIn: 1,
      repeatedScans: 1,
      rejectedScans: 1,
      recent: [expect.objectContaining({ name: "Alpha", method: "qr", scannedBy: "Ana López" })],
    });
    const etagValue = stats.response.headers.get("etag")!;
    expect(etagValue).toBeTruthy();
    const again = await ctx.app.request(`/api/v1/events/${event.id}/stats`, {
      headers: { cookie: organizer, "if-none-match": etagValue },
    });
    expect(again.status).toBe(304);
  });

  it("exports the guest list as CSV, neutralizing spreadsheet formulas", async () => {
    const { organizer, event } = await openEvent();
    const { token } = await guestWithTicket(event, "=HYPERLINK(evil)");
    await scan(organizer, event.id, token);
    const response = await ctx.app.request(`/api/v1/events/${event.id}/export.csv`, {
      headers: { cookie: organizer },
    });
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="${event.slug}-attendees.csv"`,
    );
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // UTF-8 BOM for spreadsheets
    const text = new TextDecoder().decode(bytes); // strips the BOM
    expect(text.split("\r\n")[0]).toBe("name,email,status,source,registered_at,checked_in_at");
    expect(text).toContain("'=HYPERLINK(evil)");
    expect(text).toMatch(/,\d{4}-\d{2}-\d{2}T[\d:.]+Z\r\n$/);
  });

  it("filters the guest list by check-in", async () => {
    const { organizer, event } = await openEvent();
    const a = await guestWithTicket(event, "Dentro");
    await guestWithTicket(event, "Fuera");
    await scan(organizer, event.id, a.token);
    const inside = await api<{ items: { name: string; checkedInAt: string | null }[] }>(
      ctx,
      "GET",
      `/api/v1/events/${event.id}/attendees?checkedIn=yes`,
      { cookie: organizer },
    );
    expect(inside.body.items.map((i) => i.name)).toEqual(["Dentro"]);
    expect(inside.body.items[0]!.checkedInAt).toBeTruthy();
    const outside = await api<{ items: { name: string }[] }>(
      ctx,
      "GET",
      `/api/v1/events/${event.id}/attendees?checkedIn=no`,
      { cookie: organizer },
    );
    expect(outside.body.items.map((i) => i.name)).toEqual(["Fuera"]);
  });
});
