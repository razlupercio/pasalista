// SPDX-License-Identifier: AGPL-3.0-or-later
// Basic teams through Better Auth's organization plugin (ADR-0003, ADR-0008).
import { afterAll, describe, expect, it } from "vitest";
import {
  api,
  createEvent,
  createTestContext,
  latestEmail,
  newOrganizer,
  signUpAndVerify,
  uniqueEmail,
  type EventBody,
} from "./helpers.ts";

const ctx = createTestContext();
afterAll(() => ctx.close());

const auth = <T = unknown>(cookie: string, path: string, body?: unknown, method = "POST") =>
  api<T>(ctx, method, `/api/v1/auth/organization/${path}`, { cookie, body });

async function inviteToTeam(owner: string, email: string, role = "member") {
  const result = await auth<{ id?: string }>(owner, "invite-member", { email, role });
  const mail = await latestEmail(ctx, email);
  if (mail?.kind !== "team_invitation")
    throw new Error(`no team invitation: ${JSON.stringify(result.body)}`);
  return new URL(String(mail.payload.url)).pathname.split("/").at(-1)!;
}

describe("teams", () => {
  it("invites a co-organizer by email who then manages the organization's events", async () => {
    const owner = await newOrganizer(ctx);
    const event = await createEvent(ctx, owner);
    const teammateEmail = uniqueEmail("teammate");
    const invitationId = await inviteToTeam(owner, teammateEmail);

    const teammate = await signUpAndVerify(ctx, teammateEmail);
    const accepted = await auth(teammate, "accept-invitation", { invitationId });
    expect(accepted.status).toBe(200);

    // The invitation's organization becomes active; its events are now listed and editable.
    await auth(teammate, "set-active", { organizationId: event.organizationId });
    const list = await api<EventBody[]>(ctx, "GET", "/api/v1/events", { cookie: teammate });
    expect(list.body.map((e) => e.id)).toContain(event.id);
    const edit = await api(ctx, "PATCH", `/api/v1/events/${event.id}`, {
      cookie: teammate,
      body: { name: "Edited by teammate" },
    });
    expect(edit.status).toBe(200);
  });

  it("only lets the invited email accept", async () => {
    const owner = await newOrganizer(ctx);
    const invitationId = await inviteToTeam(owner, uniqueEmail("invited"));
    const intruder = await signUpAndVerify(ctx, uniqueEmail("intruder"));
    const result = await auth(intruder, "accept-invitation", { invitationId });
    expect(result.status).toBeGreaterThanOrEqual(400);
  });

  it("does not let plain members invite others", async () => {
    const owner = await newOrganizer(ctx);
    const memberEmail = uniqueEmail("member");
    const invitationId = await inviteToTeam(owner, memberEmail, "member");
    const member = await signUpAndVerify(ctx, memberEmail);
    await auth(member, "accept-invitation", { invitationId });
    const attempt = await auth(member, "invite-member", { email: uniqueEmail(), role: "member" });
    expect(attempt.status).toBe(403);
  });

  it("disables organization deletion (data purge is designed in Phase 5)", async () => {
    const owner = await newOrganizer(ctx);
    const event = await createEvent(ctx, owner);
    const result = await auth(owner, "delete", { organizationId: event.organizationId });
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect((await api(ctx, "GET", `/api/v1/events/${event.id}`, { cookie: owner })).status).toBe(
      200,
    );
  });
});
