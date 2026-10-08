// SPDX-License-Identifier: AGPL-3.0-or-later
import { publicKeyFromSecret } from "@pasalista/core";
import { schema } from "@pasalista/db";
import { asc, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { decryptSecret, loadKek } from "../src/crypto/key-encryption.ts";
import {
  api,
  createEvent,
  createPublishedEvent,
  createTestContext,
  eventInput,
  newOrganizer,
  type EventBody,
} from "./helpers.ts";

const ctx = createTestContext();
afterAll(() => ctx.close());

describe("event management", () => {
  it("requires a session", async () => {
    expect((await api(ctx, "GET", "/api/v1/events", { cookie: null })).status).toBe(401);
    expect(
      (await api(ctx, "POST", "/api/v1/events", { cookie: null, body: eventInput() })).status,
    ).toBe(401);
  });

  it("creates a draft in the organizer's organization with an encrypted signing key", async () => {
    const cookie = await newOrganizer(ctx);
    const event = await createEvent(ctx, cookie, { name: "Café & Código: Edición #3" });
    expect(event.status).toBe("draft");
    expect(event.slug).toMatch(/^cafe-codigo-edicion-3-[a-z0-9]{6}$/);

    const [key] = await ctx.db
      .select()
      .from(schema.eventSigningKeys)
      .where(eq(schema.eventSigningKeys.eventId, event.id));
    expect(key).toMatchObject({ version: 1, status: "active", kekId: "k1" });
    const kek = loadKek(ctx.env.QR_KEY_ENCRYPTION_KEY, "k1");
    const secret = decryptSecret(
      kek,
      key!.privateKeyCiphertext,
      `pasalista:event-key:${event.id}:1`,
    );
    expect(publicKeyFromSecret(secret)).toEqual(key!.publicKey);
  });

  it("validates input, including cross-field dates", async () => {
    const cookie = await newOrganizer(ctx);
    const input = eventInput();
    const bad = await api<{ code: string; issues: { path: string[] }[] }>(
      ctx,
      "POST",
      "/api/v1/events",
      {
        cookie,
        body: { ...input, endsAt: input.startsAt, timezone: "Nowhere/City" },
      },
    );
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe("validation_failed");
    expect(bad.body.issues.map((i) => i.path.join("."))).toEqual(
      expect.arrayContaining(["endsAt", "timezone"]),
    );

    const event = await createEvent(ctx, cookie);
    const patch = await api(ctx, "PATCH", `/api/v1/events/${event.id}`, {
      cookie,
      body: { endsAt: new Date(Date.parse(input.startsAt) - 1000).toISOString() },
    });
    expect(patch.status).toBe(400);
  });

  it("lists only the events of the organizer's organization", async () => {
    const alice = await newOrganizer(ctx);
    const bob = await newOrganizer(ctx);
    const event = await createEvent(ctx, alice);
    const aliceList = await api<EventBody[]>(ctx, "GET", "/api/v1/events", { cookie: alice });
    const bobList = await api<EventBody[]>(ctx, "GET", "/api/v1/events", { cookie: bob });
    expect(aliceList.body.map((e) => e.id)).toContain(event.id);
    expect(bobList.body.map((e) => e.id)).not.toContain(event.id);
  });

  it("hides other organizations' events behind 404 for every operation", async () => {
    const alice = await newOrganizer(ctx);
    const bob = await newOrganizer(ctx);
    const { id } = await createEvent(ctx, alice);
    const attempts = await Promise.all([
      api(ctx, "GET", `/api/v1/events/${id}`, { cookie: bob }),
      api(ctx, "PATCH", `/api/v1/events/${id}`, { cookie: bob, body: { name: "Hacked" } }),
      api(ctx, "DELETE", `/api/v1/events/${id}`, { cookie: bob }),
      api(ctx, "POST", `/api/v1/events/${id}/publish`, { cookie: bob }),
      api(ctx, "POST", `/api/v1/events/${id}/close`, { cookie: bob }),
      api(ctx, "POST", `/api/v1/events/${id}/signing-keys/rotate`, { cookie: bob }),
      api(ctx, "GET", `/api/v1/events/${id}/attendees`, { cookie: bob }),
    ]);
    expect(attempts.map((a) => a.status)).toEqual([404, 404, 404, 404, 404, 404, 404]);
    const [row] = await ctx.db.select().from(schema.events).where(eq(schema.events.id, id));
    expect(row).toMatchObject({ name: "Meetup de prueba", status: "draft" });
  });

  it("lets other members of the same organization manage the event", async () => {
    const alice = await newOrganizer(ctx);
    const event = await createEvent(ctx, alice);
    const bob = await newOrganizer(ctx);
    // Team invitations arrive in Phase 3; add the membership directly.
    const session = await api<{ user: { id: string } }>(ctx, "GET", "/api/v1/auth/get-session", {
      cookie: bob,
    });
    await ctx.db.insert(schema.organizationMembers).values({
      organizationId: event.organizationId,
      userId: session.body.user.id,
      role: "member",
    });
    const result = await api<EventBody>(ctx, "PATCH", `/api/v1/events/${event.id}`, {
      cookie: bob,
      body: { name: "Edited by a teammate" },
    });
    expect(result.status).toBe(200);
  });

  it("enforces status transitions and only deletes drafts", async () => {
    const cookie = await newOrganizer(ctx);
    const draft = await createEvent(ctx, cookie);
    expect((await api(ctx, "POST", `/api/v1/events/${draft.id}/close`, { cookie })).status).toBe(
      409,
    );
    expect((await api(ctx, "DELETE", `/api/v1/events/${draft.id}`, { cookie })).status).toBe(204);

    const event = await createPublishedEvent(ctx, cookie);
    expect(event.status).toBe("published");
    expect((await api(ctx, "DELETE", `/api/v1/events/${event.id}`, { cookie })).status).toBe(409);
    const closed = await api<EventBody>(ctx, "POST", `/api/v1/events/${event.id}/close`, {
      cookie,
    });
    expect(closed.body.status).toBe("closed");
    const reopened = await api<EventBody>(ctx, "POST", `/api/v1/events/${event.id}/publish`, {
      cookie,
    });
    expect(reopened.body.status).toBe("published");
  });

  it("allows editing a published event", async () => {
    const cookie = await newOrganizer(ctx);
    const event = await createPublishedEvent(ctx, cookie);
    const edited = await api<EventBody & { venueName: string }>(
      ctx,
      "PATCH",
      `/api/v1/events/${event.id}`,
      {
        cookie,
        body: { venueName: "Nuevo lugar" },
      },
    );
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ venueName: "Nuevo lugar", status: "published" });
  });

  it("rotates the signing key, retiring the previous version", async () => {
    const cookie = await newOrganizer(ctx);
    const event = await createEvent(ctx, cookie);
    const rotated = await api<{ version: number }>(
      ctx,
      "POST",
      `/api/v1/events/${event.id}/signing-keys/rotate`,
      {
        cookie,
      },
    );
    expect(rotated.body.version).toBe(2);
    const keys = await ctx.db
      .select({ version: schema.eventSigningKeys.version, status: schema.eventSigningKeys.status })
      .from(schema.eventSigningKeys)
      .where(eq(schema.eventSigningKeys.eventId, event.id))
      .orderBy(asc(schema.eventSigningKeys.version));
    expect(keys).toEqual([
      { version: 1, status: "retired" },
      { version: 2, status: "active" },
    ]);
  });
});

describe("public event page", () => {
  it("does not expose drafts", async () => {
    const cookie = await newOrganizer(ctx);
    const draft = await createEvent(ctx, cookie);
    expect(
      (await api(ctx, "GET", `/api/v1/public/events/${draft.slug}`, { cookie: null })).status,
    ).toBe(404);
  });

  it("shows published events with their registration state and no internal ids", async () => {
    const cookie = await newOrganizer(ctx);
    const event = await createPublishedEvent(ctx, cookie, { registrationMode: "closed" });
    const page = await api<Record<string, unknown>>(
      ctx,
      "GET",
      `/api/v1/public/events/${event.slug}`,
      {
        cookie: null,
      },
    );
    expect(page.status).toBe(200);
    expect(page.body).toMatchObject({
      slug: event.slug,
      organizerName: "Ana López",
      registrationState: "invitation_only",
    });
    expect(page.body).not.toHaveProperty("id");
    expect(page.body).not.toHaveProperty("organizationId");
    expect(page.body).not.toHaveProperty("capacity");
  });
});
