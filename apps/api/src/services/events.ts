// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  eventDateIssues,
  type Event,
  type EventInput,
  type EventStatus,
  type EventUpdate,
} from "@pasalista/core";
import { schema } from "@pasalista/db";
import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { ApiError } from "../errors.ts";
import { nowOf, type Executor, type ServiceDeps } from "./context.ts";
import { audit } from "./audit.ts";
import { createSigningKey, rotateSigningKey } from "./signing-keys.ts";

const { events, attendees, checkIns, organizationMembers } = schema;

type EventRow = typeof events.$inferSelect;

/** URL slug from the event name plus a random suffix, e.g. `meetup-gdl-x7k2p9`. */
export function makeSlug(name: string): string {
  const base = name
    .normalize("NFD")
    .replace(/[\u0300-\u036F]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  const suffix = Array.from(randomBytes(6), (b) => alphabet[b % alphabet.length]).join("");
  return base ? `${base}-${suffix}` : suffix;
}

export interface EventCounts {
  registered: number;
  checkedIn: number;
}

/** Purged events keep only their final totals (ADR-0011). */
export function toEventDto(row: EventRow, live: EventCounts): Event {
  const counts = row.purgedAt
    ? { registered: row.finalRegisteredCount ?? 0, checkedIn: row.finalCheckedInCount ?? 0 }
    : live;
  return {
    id: row.id,
    organizationId: row.organizationId,
    slug: row.slug,
    name: row.name,
    description: row.description,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt?.toISOString() ?? null,
    timezone: row.timezone,
    venueName: row.venueName,
    venueAddress: row.venueAddress,
    capacity: row.capacity,
    registrationMode: row.registrationMode,
    registrationDeadline: row.registrationDeadline?.toISOString() ?? null,
    registrationFields: row.registrationFields,
    status: row.status,
    registeredCount: counts.registered,
    checkedInCount: counts.checkedIn,
    purgedAt: row.purgedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const toDate = (value: string | null | undefined) =>
  value === undefined ? undefined : value === null ? null : new Date(value);

/** API representation (ISO strings) to column values (Date). Undefined fields are left untouched. */
function toColumns(input: EventUpdate) {
  const { startsAt, endsAt, registrationDeadline, ...rest } = input;
  return {
    ...rest,
    startsAt: startsAt === undefined ? undefined : new Date(startsAt),
    endsAt: toDate(endsAt),
    registrationDeadline: toDate(registrationDeadline),
  };
}

export async function countActiveAttendees(db: Executor, eventId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(attendees)
    .where(and(eq(attendees.eventId, eventId), eq(attendees.status, "active")));
  return row?.value ?? 0;
}

/** Registered (active) and checked-in totals for several events at once. */
export async function eventCounts(
  db: Executor,
  eventIds: string[],
): Promise<Map<string, EventCounts>> {
  const result = new Map<string, EventCounts>(
    eventIds.map((id) => [id, { registered: 0, checkedIn: 0 }]),
  );
  if (eventIds.length === 0) return result;
  const [registered, checkedIn] = await Promise.all([
    db
      .select({ eventId: attendees.eventId, value: count() })
      .from(attendees)
      .where(and(inArray(attendees.eventId, eventIds), eq(attendees.status, "active")))
      .groupBy(attendees.eventId),
    db
      .select({ eventId: checkIns.eventId, value: count() })
      .from(checkIns)
      .where(inArray(checkIns.eventId, eventIds))
      .groupBy(checkIns.eventId),
  ]);
  for (const row of registered) result.get(row.eventId)!.registered = row.value;
  for (const row of checkedIn) result.get(row.eventId)!.checkedIn = row.value;
  return result;
}

async function countsFor(db: Executor, eventId: string): Promise<EventCounts> {
  return (await eventCounts(db, [eventId])).get(eventId)!;
}

/**
 * The organization new events belong to: the session's active organization when the user is a
 * member, otherwise their oldest membership (the personal organization).
 */
export async function resolveOrganization(
  db: Executor,
  userId: string,
  activeOrganizationId: string | null,
): Promise<string> {
  const memberships = await db
    .select({ organizationId: organizationMembers.organizationId })
    .from(organizationMembers)
    .where(eq(organizationMembers.userId, userId))
    .orderBy(asc(organizationMembers.createdAt));
  const match =
    memberships.find((m) => m.organizationId === activeOrganizationId) ?? memberships[0];
  if (!match) throw new ApiError(403, "forbidden", "No organization");
  return match.organizationId;
}

/**
 * Loads an event the user may manage (any role in the owning organization). Events of other
 * organizations answer 404, so their existence is not revealed.
 */
export async function findManagedEvent(
  db: Executor,
  userId: string,
  eventId: string,
  options: { forUpdate?: boolean } = {},
): Promise<EventRow> {
  const query = db
    .select({ event: events })
    .from(events)
    .innerJoin(
      organizationMembers,
      and(
        eq(organizationMembers.organizationId, events.organizationId),
        eq(organizationMembers.userId, userId),
      ),
    )
    .where(eq(events.id, eventId));
  const [row] = options.forUpdate ? await query.for("update", { of: events }) : await query;
  if (!row) throw new ApiError(404, "not_found");
  return row.event;
}

/** Purged events are read-only (ADR-0011). */
export function assertNotPurged(event: Pick<EventRow, "purgedAt">): void {
  if (event.purgedAt) throw new ApiError(409, "invalid_state", "The event data was purged");
}

export async function listEvents(db: Executor, organizationId: string): Promise<Event[]> {
  const rows = await db
    .select()
    .from(events)
    .where(eq(events.organizationId, organizationId))
    .orderBy(desc(events.startsAt));
  const counts = await eventCounts(
    db,
    rows.map((r) => r.id),
  );
  return rows.map((row) => toEventDto(row, counts.get(row.id)!));
}

export async function createEvent(
  deps: ServiceDeps,
  user: { id: string },
  organizationId: string,
  input: EventInput,
): Promise<Event> {
  return deps.db.transaction(async (tx) => {
    const [row] = await tx
      .insert(events)
      .values({
        ...toColumns(input),
        name: input.name,
        startsAt: new Date(input.startsAt),
        timezone: input.timezone,
        venueName: input.venueName,
        organizationId,
        slug: makeSlug(input.name),
        createdBy: user.id,
      })
      .returning();
    if (!row) throw new Error("Insert failed");
    await createSigningKey(tx, deps.kek, row.id, 1);
    return toEventDto(row, { registered: 0, checkedIn: 0 });
  });
}

export async function getEvent(deps: ServiceDeps, userId: string, eventId: string): Promise<Event> {
  const row = await findManagedEvent(deps.db, userId, eventId);
  return toEventDto(row, await countsFor(deps.db, row.id));
}

export async function updateEvent(
  deps: ServiceDeps,
  userId: string,
  eventId: string,
  patch: EventUpdate,
): Promise<Event> {
  return deps.db.transaction(async (tx) => {
    const current = await findManagedEvent(tx, userId, eventId, { forUpdate: true });
    assertNotPurged(current);
    const merged = {
      startsAt: patch.startsAt ?? current.startsAt.toISOString(),
      endsAt: patch.endsAt !== undefined ? patch.endsAt : (current.endsAt?.toISOString() ?? null),
      registrationDeadline:
        patch.registrationDeadline !== undefined
          ? patch.registrationDeadline
          : (current.registrationDeadline?.toISOString() ?? null),
    };
    const issues = eventDateIssues(merged);
    if (issues.length > 0) throw new ApiError(400, "validation_failed", undefined, issues);

    const [row] = await tx
      .update(events)
      .set(toColumns(patch))
      .where(eq(events.id, eventId))
      .returning();
    return toEventDto(row!, await countsFor(tx, eventId));
  });
}

const transitions: Record<"publish" | "close", { from: EventStatus[]; to: EventStatus }> = {
  publish: { from: ["draft", "closed"], to: "published" },
  close: { from: ["published"], to: "closed" },
};

export async function changeEventStatus(
  deps: ServiceDeps,
  userId: string,
  eventId: string,
  action: "publish" | "close",
): Promise<Event> {
  return deps.db.transaction(async (tx) => {
    const current = await findManagedEvent(tx, userId, eventId, { forUpdate: true });
    assertNotPurged(current);
    const { from, to } = transitions[action];
    if (!from.includes(current.status)) {
      throw new ApiError(
        409,
        "invalid_state",
        `Cannot ${action} an event that is ${current.status}`,
      );
    }
    const [row] = await tx
      .update(events)
      .set({ status: to })
      .where(eq(events.id, eventId))
      .returning();
    await audit(tx, {
      organizationId: current.organizationId,
      actorUserId: userId,
      eventId,
      action: action === "publish" ? "event.publish" : "event.close",
      entityType: "event",
      entityId: eventId,
    });
    return toEventDto(row!, await countsFor(tx, eventId));
  });
}

/** Only drafts can be deleted; published events are closed instead (data purge is Phase 5). */
export async function deleteDraftEvent(
  deps: ServiceDeps,
  userId: string,
  eventId: string,
): Promise<void> {
  await deps.db.transaction(async (tx) => {
    const current = await findManagedEvent(tx, userId, eventId, { forUpdate: true });
    if (current.status !== "draft")
      throw new ApiError(409, "invalid_state", "Only drafts can be deleted");
    await audit(tx, {
      organizationId: current.organizationId,
      actorUserId: userId,
      action: "event.delete",
      entityType: "event",
      entityId: eventId,
    });
    await tx.delete(events).where(eq(events.id, eventId));
  });
}

export async function rotateEventKey(
  deps: ServiceDeps,
  userId: string,
  eventId: string,
): Promise<number> {
  return deps.db.transaction(async (tx) => {
    const event = await findManagedEvent(tx, userId, eventId, { forUpdate: true });
    assertNotPurged(event);
    const version = await rotateSigningKey(tx, deps.kek, eventId);
    await audit(tx, {
      organizationId: event.organizationId,
      actorUserId: userId,
      eventId,
      action: "event.key_rotate",
      entityType: "event",
      entityId: eventId,
      metadata: { version },
    });
    return version;
  });
}

/** When the event is over (for registration purposes). */
export function eventEnd(row: Pick<EventRow, "startsAt" | "endsAt">): Date {
  return row.endsAt ?? row.startsAt;
}

export function isPast(deps: ServiceDeps, row: Pick<EventRow, "startsAt" | "endsAt">): boolean {
  return eventEnd(row) <= nowOf(deps);
}
