// SPDX-License-Identifier: AGPL-3.0-or-later
import { schema } from "@pasalista/db";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import {
  api,
  createPublishedEvent,
  createTestContext,
  latestEmail,
  newOrganizer,
  signUpAndVerify,
  uniqueEmail,
} from "./helpers.ts";

const ctx = createTestContext();
afterAll(() => ctx.close());

async function invite(cookie: string, eventId: string, email: string) {
  return api<{ code?: string }>(ctx, "POST", `/api/v1/events/${eventId}/staff/invitations`, {
    cookie,
    body: { email, locale: "es-MX" },
  });
}

async function invitationToken(email: string): Promise<string> {
  const mail = await latestEmail(ctx, email);
  if (mail?.kind !== "staff_invitation") throw new Error("no staff invitation");
  return new URL(String(mail.payload.url)).pathname.split("/").at(-1)!;
}

const preview = (token: string) =>
  api<{ state: string; email: string; eventName: string }>(
    ctx,
    "GET",
    `/api/v1/staff-invitations/${token}`,
    {
      cookie: null,
    },
  );
const accept = (token: string, cookie: string | null) =>
  api<{ eventId?: string; code?: string }>(
    ctx,
    "POST",
    `/api/v1/staff-invitations/${token}/accept`,
    { cookie },
  );

async function setup() {
  const organizer = await newOrganizer(ctx);
  const event = await createPublishedEvent(ctx, organizer);
  const staffEmail = uniqueEmail("staff");
  await invite(organizer, event.id, staffEmail);
  return { organizer, event, staffEmail, token: await invitationToken(staffEmail) };
}

describe("staff invitations", () => {
  it("emails a single-use link that shows the event before signing in", async () => {
    const { event, staffEmail, token } = await setup();
    const mail = await latestEmail(ctx, staffEmail);
    expect(String(mail?.payload.url)).toMatch(
      /^http:\/\/localhost:3000\/es-MX\/invitations\/staff\/[\w-]{43}$/,
    );
    const shown = await preview(token);
    expect(shown.body).toEqual({
      eventName: "Meetup de prueba",
      organizerName: "Ana López",
      email: staffEmail,
      state: "pending",
    });
    const [stored] = await ctx.db
      .select({ tokenHash: schema.staffInvitations.tokenHash })
      .from(schema.staffInvitations)
      .where(eq(schema.staffInvitations.eventId, event.id));
    expect(Buffer.from(stored!.tokenHash).toString("base64url")).not.toBe(token);
  });

  it("can only be accepted by the invited account, once", async () => {
    const { organizer, event, staffEmail, token } = await setup();
    expect((await accept(token, null)).status).toBe(401);

    const someoneElse = await signUpAndVerify(ctx, uniqueEmail("other"));
    const wrong = await accept(token, someoneElse);
    expect(wrong.status).toBe(403);

    const staff = await signUpAndVerify(ctx, staffEmail);
    const ok = await accept(token, staff);
    expect(ok.body).toEqual({ eventId: event.id });
    expect((await accept(token, staff)).body.code).toBe("invalid_state");
    expect((await preview(token)).body.state).toBe("accepted");

    const assigned = await api<{ id: string }[]>(ctx, "GET", "/api/v1/me/staff-events", {
      cookie: staff,
    });
    expect(assigned.body.map((e) => e.id)).toEqual([event.id]);
    const overview = await api<{ members: { email: string }[]; invitations: unknown[] }>(
      ctx,
      "GET",
      `/api/v1/events/${event.id}/staff`,
      { cookie: organizer },
    );
    expect(overview.body.members.map((m) => m.email)).toEqual([staffEmail]);
    expect(overview.body.invitations).toEqual([]);
  });

  it("does not let staff manage the event", async () => {
    const { event, staffEmail, token } = await setup();
    const staff = await signUpAndVerify(ctx, staffEmail);
    await accept(token, staff);
    expect((await api(ctx, "GET", `/api/v1/events/${event.id}`, { cookie: staff })).status).toBe(
      404,
    );
    expect(
      (await api(ctx, "GET", `/api/v1/events/${event.id}/attendees`, { cookie: staff })).status,
    ).toBe(404);
  });

  it("revokes a previous invitation when re-inviting the same email", async () => {
    const { organizer, event, staffEmail, token } = await setup();
    await invite(organizer, event.id, staffEmail);
    const newToken = await invitationToken(staffEmail);
    expect((await preview(token)).body.state).toBe("revoked");
    expect((await preview(newToken)).body.state).toBe("pending");
  });

  it("rejects expired and cancelled invitations", async () => {
    const { organizer, event, staffEmail, token } = await setup();
    await ctx.db
      .update(schema.staffInvitations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.staffInvitations.eventId, event.id));
    const staff = await signUpAndVerify(ctx, staffEmail);
    expect((await accept(token, staff)).body.code).toBe("invalid_state");

    await invite(organizer, event.id, staffEmail);
    const fresh = await invitationToken(staffEmail);
    const overview = await api<{ invitations: { id: string }[] }>(
      ctx,
      "GET",
      `/api/v1/events/${event.id}/staff`,
      {
        cookie: organizer,
      },
    );
    const [pending] = overview.body.invitations;
    await api(ctx, "DELETE", `/api/v1/events/${event.id}/staff/invitations/${pending!.id}`, {
      cookie: organizer,
    });
    expect((await preview(fresh)).body.state).toBe("revoked");
  });

  it("removes staff and refuses inviting someone who already is staff", async () => {
    const { organizer, event, staffEmail, token } = await setup();
    const staff = await signUpAndVerify(ctx, staffEmail);
    await accept(token, staff);
    expect((await invite(organizer, event.id, staffEmail)).body.code).toBe("conflict");

    const session = await api<{ user: { id: string } }>(ctx, "GET", "/api/v1/auth/get-session", {
      cookie: staff,
    });
    await api(ctx, "DELETE", `/api/v1/events/${event.id}/staff/${session.body.user.id}`, {
      cookie: organizer,
    });
    expect(
      (await api<unknown[]>(ctx, "GET", "/api/v1/me/staff-events", { cookie: staff })).body,
    ).toEqual([]);
  });

  it("keeps other organizations out", async () => {
    const { event } = await setup();
    const stranger = await newOrganizer(ctx);
    expect((await invite(stranger, event.id, uniqueEmail())).status).toBe(404);
    expect(
      (await api(ctx, "GET", `/api/v1/events/${event.id}/staff`, { cookie: stranger })).status,
    ).toBe(404);
  });
});
