// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  bytesEqual,
  fromBase64Url,
  uuidv7,
  type EventStats,
  type OfflineBundle,
  type SyncResult,
} from "@pasalista/core";
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
  uniqueEmail,
  type EventBody,
} from "./helpers.ts";

const ctx = createTestContext();
afterAll(() => ctx.close());

const MINUTE = 60_000;

async function openEvent() {
  const organizer = await newOrganizer(ctx);
  const event = await createPublishedEvent(ctx, organizer, {
    startsAt: new Date(Date.now() + 60 * MINUTE).toISOString(),
    endsAt: null,
  });
  return { organizer, event };
}

async function guest(event: EventBody, name = "Ana María López") {
  const email = uniqueEmail("guest");
  await register(ctx, event.slug, { email, name });
  const token = String((await latestEmail(ctx, email))!.payload.qrToken);
  const [attendee] = await ctx.db
    .select()
    .from(schema.attendees)
    .where(eq(schema.attendees.email, email));
  return { email, token, attendee: attendee! };
}

function bundle(cookie: string, eventId: string) {
  return api<OfflineBundle>(ctx, "GET", `/api/v1/events/${eventId}/offline-bundle`, { cookie });
}

function sync(cookie: string, eventId: string, deviceId: string, items: unknown[]) {
  return api<SyncResult>(ctx, "POST", `/api/v1/events/${eventId}/check-ins/sync`, {
    cookie,
    body: { deviceId, items },
  });
}

const qrItem = (token: string, scannedAt: Date, clientCheckInId = uuidv7()) => ({
  method: "qr",
  token,
  clientCheckInId,
  scannedAt: scannedAt.toISOString(),
});

async function checkInsOf(attendeeId: string) {
  return ctx.db.select().from(schema.checkIns).where(eq(schema.checkIns.attendeeId, attendeeId));
}

describe("offline bundle", () => {
  it("holds only what a scanner needs: keys, short names and active nonces", async () => {
    const { organizer, event } = await openEvent();
    const { attendee } = await guest(event);
    const cancelled = await guest(event, "Pedro Paramo");
    await api(ctx, "POST", `/api/v1/attendees/${cancelled.attendee.id}/cancel`, {
      cookie: organizer,
    });
    await api(ctx, "POST", `/api/v1/events/${event.id}/signing-keys/rotate`, { cookie: organizer });

    const result = await bundle(organizer, event.id);
    expect(result.status).toBe(200);
    expect(result.body.keys.map((k) => k.version).sort()).toEqual([1, 2]);
    expect(result.body.attendees).toEqual([
      expect.objectContaining({ id: attendee.id, displayName: "Ana L.", checkedInAt: null }),
    ]);
    const serialized = JSON.stringify(result.body);
    expect(serialized).not.toContain("@example.test");
    expect(serialized).not.toContain("María López");

    const [ticket] = await ctx.db
      .select()
      .from(schema.tickets)
      .where(and(eq(schema.tickets.attendeeId, attendee.id), eq(schema.tickets.status, "active")));
    expect(bytesEqual(fromBase64Url(result.body.attendees[0]!.nonce!)!, ticket!.nonce)).toBe(true);
  });

  it("is only available to organizers and assigned staff", async () => {
    const { event } = await openEvent();
    const stranger = await newOrganizer(ctx);
    expect((await bundle(stranger, event.id)).status).toBe(404);
  });
});

describe("offline sync", () => {
  it("stores a queued scan as an offline check-in, idempotently", async () => {
    const { organizer, event } = await openEvent();
    const { token, attendee } = await guest(event);
    const item = qrItem(token, new Date());
    const first = await sync(organizer, event.id, "device-a", [item]);
    expect(first.body.results[0]).toMatchObject({ status: "accepted" });
    expect(first.body.counts.checkedIn).toBe(1);
    const again = await sync(organizer, event.id, "device-a", [item]);
    expect(again.body.results[0]).toMatchObject({ status: "accepted" });
    const rows = await checkInsOf(attendee.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ mode: "offline", deviceId: "device-a", clockAdjusted: false });
  });

  it("keeps the earliest scan when two devices checked in the same person (any sync order)", async () => {
    const { organizer, event } = await openEvent();
    const { token, attendee } = await guest(event);
    const base = Date.now() - 10 * MINUTE;
    const late = qrItem(token, new Date(base + 5 * MINUTE));
    const early = qrItem(token, new Date(base));

    // The later scan reaches the server first.
    expect((await sync(organizer, event.id, "device-late", [late])).body.results[0]!.status).toBe(
      "accepted",
    );
    const second = await sync(organizer, event.id, "device-early", [early]);
    expect(second.body.results[0]).toMatchObject({
      status: "accepted",
      checkedInAt: early.scannedAt,
    });

    const [row] = await checkInsOf(attendee.id);
    expect(row).toMatchObject({ deviceId: "device-early", clientCheckInId: early.clientCheckInId });

    // The replaced device learns it was a duplicate when it retries.
    const retry = await sync(organizer, event.id, "device-late", [late]);
    expect(retry.body.results[0]).toMatchObject({
      status: "duplicate",
      checkedInAt: early.scannedAt,
    });

    const stats = await api<EventStats>(ctx, "GET", `/api/v1/events/${event.id}/stats`, {
      cookie: organizer,
    });
    expect(stats.body.offlineDuplicates).toEqual([
      expect.objectContaining({
        attendeeId: attendee.id,
        name: "Ana María López",
        keptAt: early.scannedAt,
        duplicateAt: late.scannedAt,
        deviceId: "device-late",
      }),
    ]);
  });

  it("replaces an online check-in with an earlier offline scan", async () => {
    const { organizer, event } = await openEvent();
    const { token, attendee } = await guest(event);
    await api(ctx, "POST", `/api/v1/events/${event.id}/check-ins`, {
      cookie: organizer,
      body: { method: "qr", token, clientCheckInId: uuidv7(), deviceId: "online" },
    });
    const earlier = qrItem(token, new Date(Date.now() - 3 * MINUTE));
    expect((await sync(organizer, event.id, "offline", [earlier])).body.results[0]!.status).toBe(
      "accepted",
    );
    expect((await checkInsOf(attendee.id))[0]).toMatchObject({
      mode: "offline",
      deviceId: "offline",
    });
  });

  it("keeps exactly one check-in when two devices sync the same person concurrently", async () => {
    const { organizer, event } = await openEvent();
    const { token, attendee } = await guest(event);
    const now = Date.now();
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        sync(organizer, event.id, `device-${i}`, [qrItem(token, new Date(now - i * MINUTE))]),
      ),
    );
    const statuses = results.map((r) => r.body.results[0]!.status);
    expect(statuses.filter((s) => s === "accepted").length).toBeGreaterThanOrEqual(1);
    const rows = await checkInsOf(attendee.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.deviceId).toBe("device-5"); // the earliest scan
  });

  it("rejects scans of tickets revoked after the bundle was downloaded", async () => {
    const { organizer, event } = await openEvent();
    const { token, attendee } = await guest(event);
    await api(ctx, "POST", `/api/v1/attendees/${attendee.id}/ticket/revoke`, { cookie: organizer });
    const result = await sync(organizer, event.id, "device", [qrItem(token, new Date())]);
    expect(result.body.results[0]).toMatchObject({ status: "rejected", outcome: "revoked" });
    expect(await checkInsOf(attendee.id)).toHaveLength(0);
  });

  it("clamps device clocks set in the future and flags the check-in", async () => {
    const { organizer, event } = await openEvent();
    const { token, attendee } = await guest(event);
    const future = new Date(Date.now() + 3 * 60 * MINUTE);
    await sync(organizer, event.id, "device", [qrItem(token, future)]);
    const [row] = await checkInsOf(attendee.id);
    expect(row!.clockAdjusted).toBe(true);
    expect(row!.scannedAt.getTime()).toBeLessThan(future.getTime());
  });

  it("limits a sync to 500 items", async () => {
    const { organizer, event } = await openEvent();
    const items = Array.from({ length: 501 }, () => qrItem("PL1.x", new Date()));
    expect((await sync(organizer, event.id, "device", items)).status).toBe(400);
  });
});
