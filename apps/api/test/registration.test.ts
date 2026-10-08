// SPDX-License-Identifier: AGPL-3.0-or-later
import { bytesEqual, verifyTicketToken, type TicketView } from "@pasalista/core";
import { schema } from "@pasalista/db";
import { and, desc, eq } from "drizzle-orm";
import { pino } from "pino";
import { afterAll, describe, expect, it } from "vitest";
import { processOutboxBatch } from "../src/email/outbox.ts";
import type { OutgoingEmail } from "../src/email/transport.ts";
import { verificationKeys } from "../src/services/signing-keys.ts";
import {
  api,
  createPublishedEvent,
  createTestContext,
  latestEmail,
  newOrganizer,
  randomIp,
  register,
  ticketAccessToken,
  uniqueEmail,
  type EventBody,
} from "./helpers.ts";

const ctx = createTestContext();
afterAll(() => ctx.close());

const view = (accessToken: string) =>
  api<TicketView & { code?: string; instance?: string }>(
    ctx,
    "GET",
    `/api/v1/public/tickets/${accessToken}`,
    {
      cookie: null,
    },
  );

async function attendeeByEmail(email: string) {
  const [row] = await ctx.db
    .select()
    .from(schema.attendees)
    .where(eq(schema.attendees.email, email));
  return row!;
}

async function ticketsOf(attendeeId: string) {
  return ctx.db
    .select()
    .from(schema.tickets)
    .where(eq(schema.tickets.attendeeId, attendeeId))
    .orderBy(desc(schema.tickets.issuedAt));
}

async function verify(eventId: string, qrToken: string) {
  const keys = (await verificationKeys(ctx.db, [eventId])).get(eventId)!;
  return verifyTicketToken(qrToken, { eventId, publicKeys: keys });
}

describe("open registration", () => {
  it("registers the attendee, issues a signed ticket and queues the ticket email", async () => {
    const organizer = await newOrganizer(ctx);
    const event = await createPublishedEvent(ctx, organizer);
    const email = uniqueEmail("guest");
    const result = await register(ctx, event.slug, { email: email.toUpperCase(), locale: "en" });
    expect(result.status).toBe(201);

    const attendee = await attendeeByEmail(email);
    expect(attendee).toMatchObject({ status: "active", source: "open_registration", locale: "en" });
    const [ticket] = await ticketsOf(attendee.id);
    expect(ticket).toMatchObject({ status: "active", keyVersion: 1 });

    const mail = await latestEmail(ctx, email);
    expect(mail).toMatchObject({
      kind: "ticket",
      locale: "en",
      organizationId: event.organizationId,
    });
    const checked = await verify(event.id, String(mail!.payload.qrToken));
    expect(checked.ok).toBe(true);
    if (checked.ok) {
      expect(checked.payload.attendeeId).toBe(attendee.id);
      expect(bytesEqual(checked.payload.nonce, ticket!.nonce)).toBe(true);
    }
  });

  it("delivers the ticket email with the QR attached and clears the payload", async () => {
    const organizer = await newOrganizer(ctx);
    const event = await createPublishedEvent(ctx, organizer);
    const email = uniqueEmail("guest");
    await register(ctx, event.slug, { email });
    const sent: OutgoingEmail[] = [];
    await processOutboxBatch(
      ctx.db,
      { send: (m) => Promise.resolve(void sent.push(m)) },
      pino({ level: "silent" }),
      { batchSize: 1_000 },
    );
    const mail = sent.find((m) => m.to === email);
    expect(mail?.subject).toBe("Tu boleto para Meetup de prueba");
    expect(mail?.attachments?.[0]?.cid).toBe("ticket-qr");
    expect((await latestEmail(ctx, email))?.payload).toEqual({});
  });

  it("rejects an email that is already registered", async () => {
    const organizer = await newOrganizer(ctx);
    const event = await createPublishedEvent(ctx, organizer);
    const email = uniqueEmail("guest");
    await register(ctx, event.slug, { email });
    const again = await register(ctx, event.slug, { email });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("already_registered");
  });

  it("refuses closed-list events, unknown events and passed deadlines", async () => {
    const organizer = await newOrganizer(ctx);
    const closed = await createPublishedEvent(ctx, organizer, { registrationMode: "closed" });
    expect((await register(ctx, closed.slug, { email: uniqueEmail() })).body.code).toBe(
      "registration_closed",
    );
    expect((await register(ctx, "no-such-event", { email: uniqueEmail() })).status).toBe(404);

    const late = await createPublishedEvent(ctx, organizer, {
      registrationDeadline: new Date(Date.now() - 60_000).toISOString(),
    });
    const result = await register(ctx, late.slug, { email: uniqueEmail() });
    expect(result.status).toBe(403);
    expect(result.body.code).toBe("registration_closed");
  });

  it("refuses registrations once the event is closed", async () => {
    const organizer = await newOrganizer(ctx);
    const event = await createPublishedEvent(ctx, organizer);
    await api(ctx, "POST", `/api/v1/events/${event.id}/close`, { cookie: organizer });
    expect((await register(ctx, event.slug, { email: uniqueEmail() })).body.code).toBe(
      "registration_closed",
    );
  });

  it("validates answers against the event's questions", async () => {
    const organizer = await newOrganizer(ctx);
    const event = await createPublishedEvent(ctx, organizer, {
      registrationFields: [
        { type: "select", key: "size", label: "Talla", required: true, options: ["S", "M"] },
        { type: "checkbox", key: "terms", label: "Acepto", required: true },
      ],
    });
    const bad = await register(ctx, event.slug, { email: uniqueEmail(), answers: { size: "XL" } });
    expect(bad.status).toBe(400);
    expect(bad.body.issues?.map((i) => i.path.join("."))).toEqual([
      "answers.size",
      "answers.terms",
    ]);
    const ok = await register(ctx, event.slug, {
      email: uniqueEmail(),
      answers: { size: "M", terms: true },
    });
    expect(ok.status).toBe(201);
  });

  it("never exceeds capacity, even under concurrent registrations", async () => {
    const organizer = await newOrganizer(ctx);
    const event = await createPublishedEvent(ctx, organizer, { capacity: 5 });
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        register(ctx, event.slug, { email: uniqueEmail() }, randomIp()),
      ),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(5);
    expect(statuses.filter((s) => s === 409)).toHaveLength(7);
    const page = await api<{ registrationState: string }>(
      ctx,
      "GET",
      `/api/v1/public/events/${event.slug}`,
      {
        cookie: null,
      },
    );
    expect(page.body.registrationState).toBe("full");
  });

  it("is rate limited per client IP", async () => {
    const organizer = await newOrganizer(ctx);
    const event = await createPublishedEvent(ctx, organizer);
    const ip = randomIp();
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++)
      statuses.push((await register(ctx, event.slug, { email: uniqueEmail() }, ip)).status);
    expect(statuses.slice(0, 10).every((s) => s === 201)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});

describe("my ticket", () => {
  async function registered(overrides: Record<string, unknown> = {}) {
    const organizer = await newOrganizer(ctx);
    const event = await createPublishedEvent(ctx, organizer, overrides);
    const email = uniqueEmail("guest");
    await register(ctx, event.slug, { email, name: "Sam Doe" });
    return { organizer, event, email, accessToken: await ticketAccessToken(ctx, email) };
  }

  it("shows the ticket with a QR that verifies, and nothing for unknown links", async () => {
    const { event, accessToken } = await registered();
    const ticket = await view(accessToken);
    expect(ticket.status).toBe(200);
    expect(ticket.body).toMatchObject({
      attendee: { name: "Sam Doe", status: "active" },
      event: { slug: event.slug, organizerName: "Ana López" },
      ticket: { status: "active" },
    });
    expect((await verify(event.id, ticket.body.ticket.qrToken!)).ok).toBe(true);

    const unknown = await view("A".repeat(43));
    expect(unknown.status).toBe(404);
    expect(unknown.body.instance).toBe("/api/v1/public/tickets/:redacted");
  });

  it("serves the QR as PNG, inline or as a download", async () => {
    const { accessToken, event } = await registered();
    const inline = await ctx.app.request(`/api/v1/public/tickets/${accessToken}/qr.png`);
    expect(inline.headers.get("content-type")).toBe("image/png");
    expect(inline.headers.get("content-disposition")).toBe("inline");
    const download = await ctx.app.request(
      `/api/v1/public/tickets/${accessToken}/qr.png?download=1`,
    );
    expect(download.headers.get("content-disposition")).toBe(
      `attachment; filename="ticket-${event.slug}.png"`,
    );
  });

  it("lets the attendee cancel, freeing the spot, and register again with a new link", async () => {
    const { event, email, accessToken } = await registered({ capacity: 1 });
    const cancel = await api(ctx, "POST", `/api/v1/public/tickets/${accessToken}/cancel`, {
      cookie: null,
    });
    expect(cancel.status).toBe(204);
    const after = await view(accessToken);
    expect(after.body.attendee.status).toBe("cancelled");
    expect(after.body.ticket).toEqual({ status: "revoked", qrToken: null });
    expect(
      (await api(ctx, "GET", `/api/v1/public/tickets/${accessToken}/qr.png`, { cookie: null }))
        .status,
    ).toBe(404);

    expect((await register(ctx, event.slug, { email })).status).toBe(201);
    const newToken = await ticketAccessToken(ctx, email);
    expect(newToken).not.toBe(accessToken);
    expect((await view(accessToken)).status).toBe(404);
    expect((await view(newToken)).body.ticket.status).toBe("active");
  });

  it("requires a trusted origin to cancel", async () => {
    const { accessToken } = await registered();
    const response = await ctx.app.request(`/api/v1/public/tickets/${accessToken}/cancel`, {
      method: "POST",
      headers: { origin: "https://evil.example" },
    });
    expect(response.status).toBe(403);
  });
});

describe("organizer ticket operations", () => {
  async function setup() {
    const organizer = await newOrganizer(ctx);
    const event = await createPublishedEvent(ctx, organizer);
    const email = uniqueEmail("guest");
    await register(ctx, event.slug, { email });
    const attendee = await attendeeByEmail(email);
    return { organizer, event, email, attendee, accessToken: await ticketAccessToken(ctx, email) };
  }

  it("lists attendees with their ticket status", async () => {
    const { organizer, event, email } = await setup();
    const list = await api<{ email: string; ticketStatus: string }[]>(
      ctx,
      "GET",
      `/api/v1/events/${event.id}/attendees`,
      { cookie: organizer },
    );
    expect(list.body).toEqual([
      expect.objectContaining({ email, ticketStatus: "active", status: "active" }),
    ]);
  });

  it("reissues: new QR and link by email, the old ones stop working", async () => {
    const { organizer, event, email, attendee, accessToken } = await setup();
    const oldQr = (await view(accessToken)).body.ticket.qrToken!;
    expect(
      (
        await api(ctx, "POST", `/api/v1/attendees/${attendee.id}/ticket/reissue`, {
          cookie: organizer,
        })
      ).status,
    ).toBe(204);

    const newToken = await ticketAccessToken(ctx, email);
    expect((await view(accessToken)).status).toBe(404);
    const fresh = await view(newToken);
    expect(fresh.body.ticket.qrToken).not.toBe(oldQr);
    const tickets = await ticketsOf(attendee.id);
    expect(tickets.map((t) => t.status)).toEqual(["active", "superseded"]);
    // The old QR still carries a valid signature; scanners reject it because its nonce no
    // longer matches the active ticket (checked in Phase 4).
    expect((await verify(event.id, oldQr)).ok).toBe(true);
  });

  it("revokes the QR without cancelling the registration", async () => {
    const { organizer, attendee, accessToken } = await setup();
    await api(ctx, "POST", `/api/v1/attendees/${attendee.id}/ticket/revoke`, { cookie: organizer });
    const after = await view(accessToken);
    expect(after.body).toMatchObject({
      attendee: { status: "active" },
      ticket: { status: "revoked", qrToken: null },
    });
  });

  it("cancels registrations", async () => {
    const { organizer, attendee, accessToken } = await setup();
    await api(ctx, "POST", `/api/v1/attendees/${attendee.id}/cancel`, { cookie: organizer });
    expect((await view(accessToken)).body.attendee.status).toBe("cancelled");
    const reissue = await api(ctx, "POST", `/api/v1/attendees/${attendee.id}/ticket/reissue`, {
      cookie: organizer,
    });
    expect(reissue.status).toBe(409);
  });

  it("does not let organizers of other organizations touch attendees", async () => {
    const { attendee } = await setup();
    const stranger = await newOrganizer(ctx);
    for (const action of ["ticket/reissue", "ticket/revoke", "cancel"]) {
      const result = await api(ctx, "POST", `/api/v1/attendees/${attendee.id}/${action}`, {
        cookie: stranger,
      });
      expect(result.status).toBe(404);
    }
    const [ticket] = await ctx.db
      .select()
      .from(schema.tickets)
      .where(and(eq(schema.tickets.attendeeId, attendee.id), eq(schema.tickets.status, "active")));
    expect(ticket).toBeDefined();
  });

  it("signs new tickets with the rotated key while old tickets keep verifying", async () => {
    const { organizer, event, accessToken } = await setup();
    await api(ctx, "POST", `/api/v1/events/${event.id}/signing-keys/rotate`, { cookie: organizer });
    const email = uniqueEmail("late");
    await register(ctx, event.slug, { email });
    const newer = await view(await ticketAccessToken(ctx, email));
    const older = await view(accessToken);
    const checkNew = await verify(event.id, newer.body.ticket.qrToken!);
    const checkOld = await verify(event.id, older.body.ticket.qrToken!);
    expect(checkNew.ok && checkNew.payload.keyVersion).toBe(2);
    expect(checkOld.ok && checkOld.payload.keyVersion).toBe(1);
  });
});

describe("registered count", () => {
  it("counts active registrations on the organizer's event", async () => {
    const organizer = await newOrganizer(ctx);
    const event = await createPublishedEvent(ctx, organizer);
    await register(ctx, event.slug, { email: uniqueEmail() });
    await register(ctx, event.slug, { email: uniqueEmail() });
    const result = await api<EventBody>(ctx, "GET", `/api/v1/events/${event.id}`, {
      cookie: organizer,
    });
    expect(result.body.registeredCount).toBe(2);
  });
});
