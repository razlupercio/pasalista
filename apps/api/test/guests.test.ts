// SPDX-License-Identifier: AGPL-3.0-or-later
import { verifyTicketToken, type AttendeeList, type ImportReport } from "@pasalista/core";
import { schema } from "@pasalista/db";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { verificationKeys } from "../src/services/signing-keys.ts";
import {
  api,
  createEvent,
  createPublishedEvent,
  createTestContext,
  latestEmail,
  newOrganizer,
  ticketAccessToken,
  uniqueEmail,
} from "./helpers.ts";

const ctx = createTestContext();
afterAll(() => ctx.close());

type Row = { line: number; name: string; email: string; locale: string | null };

async function closedEvent(overrides: Record<string, unknown> = {}) {
  const cookie = await newOrganizer(ctx);
  const event = await createPublishedEvent(ctx, cookie, {
    registrationMode: "closed",
    ...overrides,
  });
  return { cookie, event };
}

function importRows(cookie: string, eventId: string, rows: Row[]) {
  return api<ImportReport & { code?: string }>(
    ctx,
    "POST",
    `/api/v1/events/${eventId}/attendees/import`,
    {
      cookie,
      body: { rows, defaultLocale: "es-MX" },
    },
  );
}

function list(cookie: string, eventId: string, query = "") {
  return api<AttendeeList>(ctx, "GET", `/api/v1/events/${eventId}/attendees${query}`, { cookie });
}

function send(cookie: string, eventId: string) {
  return api<{ sent: number; code?: string }>(
    ctx,
    "POST",
    `/api/v1/events/${eventId}/invitations/send`,
    {
      cookie,
    },
  );
}

const row = (line: number, overrides: Partial<Row> = {}): Row => ({
  line,
  name: `Invitado ${line}`,
  email: uniqueEmail(`guest${line}`),
  locale: null,
  ...overrides,
});

describe("adding guests", () => {
  it("adds a guest as pending without emailing anyone", async () => {
    const { cookie, event } = await closedEvent();
    const email = uniqueEmail("guest");
    const added = await api(ctx, "POST", `/api/v1/events/${event.id}/attendees`, {
      cookie,
      body: { name: "Ana", email, locale: "en" },
    });
    expect(added.status).toBe(201);
    expect(await latestEmail(ctx, email)).toBeUndefined();
    const result = await list(cookie, event.id);
    expect(result.body.pendingCount).toBe(1);
    expect(result.body.items[0]).toMatchObject({ email, source: "manual", ticketStatus: null });

    const again = await api<{ code: string }>(ctx, "POST", `/api/v1/events/${event.id}/attendees`, {
      cookie,
      body: { name: "Ana", email: email.toUpperCase(), locale: "en" },
    });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("already_registered");
  });

  it("imports valid rows and reports every skipped row by line", async () => {
    const { cookie, event } = await closedEvent();
    const existing = uniqueEmail("existing");
    await api(ctx, "POST", `/api/v1/events/${event.id}/attendees`, {
      cookie,
      body: { name: "Existing", email: existing, locale: "es-MX" },
    });
    const good = row(2, { locale: "en" });
    const report = await importRows(cookie, event.id, [
      good,
      row(3, { email: "nope" }),
      row(4, { email: good.email.toUpperCase() }),
      row(5, { email: existing }),
      row(6, { name: "  " }),
      row(7, { locale: "fr" }),
    ]);
    expect(report.status).toBe(200);
    expect(report.body.added).toBe(1);
    expect(report.body.skipped.map((s) => [s.line, s.problem])).toEqual([
      [3, "invalid_email"],
      [4, "duplicate_in_file"],
      [5, "already_on_list"],
      [6, "invalid_name"],
      [7, "invalid_locale"],
    ]);
    const [attendee] = await ctx.db
      .select()
      .from(schema.attendees)
      .where(eq(schema.attendees.email, good.email));
    expect(attendee).toMatchObject({ source: "import", locale: "en", invitationPending: true });
  });

  it("rejects the whole import when it does not fit in the capacity", async () => {
    const { cookie, event } = await closedEvent({ capacity: 2 });
    const report = await importRows(cookie, event.id, [row(2), row(3), row(4)]);
    expect(report.status).toBe(409);
    expect(report.body.code).toBe("event_full");
    expect((await list(cookie, event.id)).body.total).toBe(0);
  });

  it("limits imports to 2,000 rows", async () => {
    const { cookie, event } = await closedEvent();
    const rows = Array.from({ length: 2001 }, (_, i) => ({
      line: i + 2,
      name: "x",
      email: `x${i}@e.test`,
      locale: null,
    }));
    expect((await importRows(cookie, event.id, rows)).status).toBe(400);
  });

  it("is only possible for the event's organization", async () => {
    const { event } = await closedEvent();
    const stranger = await newOrganizer(ctx);
    expect((await importRows(stranger, event.id, [row(2)])).status).toBe(404);
    expect((await list(stranger, event.id)).status).toBe(404);
    expect((await send(stranger, event.id)).status).toBe(404);
  });
});

describe("sending invitations", () => {
  it("queues 1,000 invitation emails in one request, each with a verifiable QR", async () => {
    const { cookie, event } = await closedEvent();
    const rows = Array.from({ length: 1000 }, (_, i) => row(i + 2));
    expect((await importRows(cookie, event.id, rows)).body.added).toBe(1000);

    const started = performance.now();
    const result = await send(cookie, event.id);
    const elapsed = performance.now() - started;
    expect(result.body.sent).toBe(1000);
    expect(elapsed).toBeLessThan(15_000);

    const emails = await ctx.db
      .select()
      .from(schema.emailOutbox)
      .where(
        and(
          eq(schema.emailOutbox.organizationId, event.organizationId),
          eq(schema.emailOutbox.kind, "ticket"),
        ),
      );
    expect(emails).toHaveLength(1000);
    expect(emails[0]?.payload).toMatchObject({
      variant: "invitation",
      eventName: "Meetup de prueba",
    });
    const keys = (await verificationKeys(ctx.db, [event.id])).get(event.id)!;
    for (const email of emails.slice(0, 20)) {
      const check = verifyTicketToken(String(email.payload.qrToken), {
        eventId: event.id,
        publicKeys: keys,
      });
      expect(check.ok).toBe(true);
    }

    const after = await list(cookie, event.id, "?ticket=pending");
    expect(after.body).toMatchObject({ total: 0, pendingCount: 0 });
    expect((await send(cookie, event.id)).body.sent).toBe(0);
  });

  it("requires the event to be published", async () => {
    const cookie = await newOrganizer(ctx);
    const draft = await createEvent(ctx, cookie, { registrationMode: "closed" });
    await importRows(cookie, draft.id, [row(2)]);
    const result = await send(cookie, draft.id);
    expect(result.status).toBe(409);
    expect(result.body.code).toBe("invalid_state");
  });

  it("gives pending guests no working ticket link until they are invited", async () => {
    const { cookie, event } = await closedEvent();
    const guest = row(2);
    await importRows(cookie, event.id, [guest]);
    expect(await latestEmail(ctx, guest.email)).toBeUndefined();
    await send(cookie, event.id);
    const token = await ticketAccessToken(ctx, guest.email);
    const view = await api<{ ticket: { status: string } }>(
      ctx,
      "GET",
      `/api/v1/public/tickets/${token}`,
      {
        cookie: null,
      },
    );
    expect(view.body.ticket.status).toBe("active");
  });

  it("puts a cancelled guest back as pending when added again, disabling the old link", async () => {
    const { cookie, event } = await closedEvent();
    const guest = row(2);
    await importRows(cookie, event.id, [guest]);
    await send(cookie, event.id);
    const oldToken = await ticketAccessToken(ctx, guest.email);
    const [attendee] = await ctx.db
      .select()
      .from(schema.attendees)
      .where(eq(schema.attendees.email, guest.email));
    await api(ctx, "POST", `/api/v1/attendees/${attendee!.id}/cancel`, { cookie });

    const report = await importRows(cookie, event.id, [{ ...guest, line: 2 }]);
    expect(report.body.added).toBe(1);
    expect((await list(cookie, event.id)).body.pendingCount).toBe(1);
    expect(
      (await api(ctx, "GET", `/api/v1/public/tickets/${oldToken}`, { cookie: null })).status,
    ).toBe(404);
  });
});

describe("per-guest actions", () => {
  async function invitedGuest() {
    const { cookie, event } = await closedEvent();
    const guest = row(2);
    await importRows(cookie, event.id, [guest]);
    const [attendee] = await ctx.db
      .select()
      .from(schema.attendees)
      .where(eq(schema.attendees.email, guest.email));
    return { cookie, event, guest, attendee: attendee! };
  }

  it("sends a single pending invitation with reissue", async () => {
    const { cookie, event, guest, attendee } = await invitedGuest();
    expect(
      (await api(ctx, "POST", `/api/v1/attendees/${attendee.id}/ticket/reissue`, { cookie }))
        .status,
    ).toBe(204);
    expect((await latestEmail(ctx, guest.email))?.payload).toMatchObject({ variant: "invitation" });
    expect((await list(cookie, event.id)).body.pendingCount).toBe(0);
  });

  it("resends the same QR with a new link", async () => {
    const { cookie, event, guest, attendee } = await invitedGuest();
    await send(cookie, event.id);
    const firstToken = await ticketAccessToken(ctx, guest.email);
    const firstQr = String((await latestEmail(ctx, guest.email))?.payload.qrToken);

    expect(
      (await api(ctx, "POST", `/api/v1/attendees/${attendee.id}/ticket/resend`, { cookie })).status,
    ).toBe(204);
    const secondToken = await ticketAccessToken(ctx, guest.email);
    expect(secondToken).not.toBe(firstToken);
    expect(String((await latestEmail(ctx, guest.email))?.payload.qrToken)).toBe(firstQr);
    expect(
      (await api(ctx, "GET", `/api/v1/public/tickets/${firstToken}`, { cookie: null })).status,
    ).toBe(404);
  });

  it("cannot resend before the invitation was sent", async () => {
    const { cookie, attendee } = await invitedGuest();
    const result = await api(ctx, "POST", `/api/v1/attendees/${attendee.id}/ticket/resend`, {
      cookie,
    });
    expect(result.status).toBe(409);
  });
});

describe("listing", () => {
  it("searches name and email case-insensitively, treating wildcards literally", async () => {
    const { cookie, event } = await closedEvent();
    await importRows(cookie, event.id, [
      row(2, { name: "María José", email: uniqueEmail("mj") }),
      row(3, { name: "Pedro", email: uniqueEmail("pedro") }),
      row(4, { name: "100% Real", email: uniqueEmail("real") }),
    ]);
    expect((await list(cookie, event.id, "?q=maría")).body.items.map((i) => i.name)).toEqual([
      "María José",
    ]);
    expect((await list(cookie, event.id, "?q=PEDRO")).body.total).toBe(1);
    expect((await list(cookie, event.id, "?q=%25")).body.items.map((i) => i.name)).toEqual([
      "100% Real",
    ]);
  });

  it("filters by status and ticket state and paginates", async () => {
    const { cookie, event } = await closedEvent();
    await importRows(cookie, event.id, [row(2), row(3), row(4), row(5)]);
    await send(cookie, event.id);
    await importRows(cookie, event.id, [row(6)]);
    const [first] = (await list(cookie, event.id)).body.items;
    await api(ctx, "POST", `/api/v1/attendees/${first!.id}/cancel`, { cookie });

    expect((await list(cookie, event.id, "?status=cancelled")).body.total).toBe(1);
    expect((await list(cookie, event.id, "?ticket=pending")).body.total).toBe(1);
    expect((await list(cookie, event.id, "?ticket=active")).body.total).toBe(3);
    expect((await list(cookie, event.id, "?ticket=revoked")).body.total).toBe(1);

    const page = await list(cookie, event.id, "?limit=2&offset=2");
    expect(page.body.items).toHaveLength(2);
    expect(page.body.total).toBe(5);
    expect((await list(cookie, event.id, "?limit=501")).status).toBe(400);
  });
});
