// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  eventDateIssues,
  type Event,
  type EventInput,
  type EventStatus,
  type EventUpdate,
} from "@pasalista/core";
import { schema } from "@pasalista/db";
import { and, asc, count, desc, eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { ApiError } from "../errors.ts";
import { nowOf, type Executor, type ServiceDeps } from "./context.ts";
import { createSigningKey, rotateSigningKey } from "./signing-keys.ts";

const { events, attendees, organizationMembers } = schema;

type EventRow = typeof events.$inferSelect;

/** URL slug from the event name plus a random suffix, e.g. `meetup-gdl-x7k2p9`. */
export function makeSlug(name: string): string {
  const base = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  const suffix = Array.from(randomBytes(6), (b) => alphabet[b % alphabet.length]).join("");
  return base ? `${base}-${suffix}` : suffix;
}

export function toEventDto(row: EventRow, registeredCount: number): Event {
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
    registeredCount,
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

export async function listEvents(db: Executor, organizationId: string): Promise<Event[]> {
  const rows = await db
    .select({ event: events, registeredCount: count(attendees.id) })
    .from(events)
    .leftJoin(attendees, and(eq(attendees.eventId, events.id), eq(attendees.status, "active")))
    .where(eq(events.organizationId, organizationId))
    .groupBy(events.id)
    .orderBy(desc(events.startsAt));
  return rows.map((r) => toEventDto(r.event, r.registeredCount));
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
    return toEventDto(row, 0);
  });
}

export async function getEvent(deps: ServiceDeps, userId: string, eventId: string): Promise<Event> {
  const row = await findManagedEvent(deps.db, userId, eventId);
  return toEventDto(row, await countActiveAttendees(deps.db, row.id));
}

export async function updateEvent(
  deps: ServiceDeps,
  userId: string,
  eventId: string,
  patch: EventUpdate,
): Promise<Event> {
  return deps.db.transaction(async (tx) => {
    const current = await findManagedEvent(tx, userId, eventId, { forUpdate: true });
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
    return toEventDto(row!, await countActiveAttendees(tx, eventId));
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
    return toEventDto(row!, await countActiveAttendees(tx, eventId));
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
    await tx.delete(events).where(eq(events.id, eventId));
  });
}

export async function rotateEventKey(
  deps: ServiceDeps,
  userId: string,
  eventId: string,
): Promise<number> {
  return deps.db.transaction(async (tx) => {
    await findManagedEvent(tx, userId, eventId, { forUpdate: true });
    return rotateSigningKey(tx, deps.kek, eventId);
  });
}

/** When the event is over (for registration purposes). */
export function eventEnd(row: Pick<EventRow, "startsAt" | "endsAt">): Date {
  return row.endsAt ?? row.startsAt;
}

export function isPast(deps: ServiceDeps, row: Pick<EventRow, "startsAt" | "endsAt">): boolean {
  return eventEnd(row) <= nowOf(deps);
}
