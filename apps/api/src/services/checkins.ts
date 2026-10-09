// SPDX-License-Identifier: AGPL-3.0-or-later
// Online check-in (ADR-0002 verification order, ADR-0009), scanner context and event stats.
import {
  bytesEqual,
  checkInWindow,
  maskEmail,
  toCsv,
  verifyTicketToken,
  type CheckInOutcome,
  type CheckInRequest,
  type CheckInResult,
  type EventStats,
  type ScanContext,
  type ScanSearchResult,
} from "@pasalista/core";
import { schema } from "@pasalista/db";
import { and, asc, count, desc, eq, ilike, or } from "drizzle-orm";
import { ApiError } from "../errors.ts";
import { findScannableEvent } from "./access.ts";
import { audit } from "./audit.ts";
import { nowOf, type Executor, type ServiceDeps } from "./context.ts";
import { countActiveAttendees, findManagedEvent } from "./events.ts";
import { verificationKeys } from "./signing-keys.ts";

const { attendees, checkIns, checkInAttempts, tickets, users } = schema;

type EventRow = typeof schema.events.$inferSelect;

async function counts(db: Executor, eventId: string) {
  const [checked] = await db
    .select({ value: count() })
    .from(checkIns)
    .where(eq(checkIns.eventId, eventId));
  return { checkedIn: checked?.value ?? 0, registered: await countActiveAttendees(db, eventId) };
}

function isScanOpen(event: EventRow, now: Date): boolean {
  if (event.status === "draft") return false;
  const { opensAt, closesAt } = checkInWindow(event);
  return now >= opensAt && now <= closesAt;
}

export async function checkIn(
  deps: ServiceDeps,
  user: { id: string },
  eventId: string,
  request: CheckInRequest,
): Promise<CheckInResult> {
  const { event } = await findScannableEvent(deps.db, user.id, eventId);
  const now = nowOf(deps);

  const respond = async (
    outcome: CheckInOutcome,
    attendee: { id: string; name: string } | null,
    checkedInAt: Date | null,
  ): Promise<CheckInResult> => ({
    outcome,
    attendee,
    checkedInAt: checkedInAt?.toISOString() ?? null,
    counts: await counts(deps.db, event.id),
  });
  const record = (outcome: CheckInOutcome, attendeeId: string | null) =>
    deps.db.insert(checkInAttempts).values({
      eventId: event.id,
      organizationId: event.organizationId,
      attendeeId,
      scannedBy: user.id,
      clientCheckInId: request.clientCheckInId,
      deviceId: request.deviceId ?? null,
      method: request.method,
      outcome,
      scannedAt: now,
    });

  // A retried request (same client id) gets the answer of the first one.
  const [retried] = await deps.db
    .select({ checkIn: checkIns, name: attendees.name })
    .from(checkIns)
    .innerJoin(attendees, eq(attendees.id, checkIns.attendeeId))
    .where(
      and(eq(checkIns.clientCheckInId, request.clientCheckInId), eq(checkIns.eventId, event.id)),
    );
  if (retried) {
    return respond(
      "valid",
      { id: retried.checkIn.attendeeId, name: retried.name },
      retried.checkIn.scannedAt,
    );
  }

  if (!isScanOpen(event, now)) {
    await record("outside_window", null);
    return respond("outside_window", null, null);
  }

  // Resolve the attendee and make sure they hold a valid credential.
  let attendeeId: string;
  let ticketId: string | null;
  if (request.method === "qr") {
    const publicKeys = (await verificationKeys(deps.db, [event.id])).get(event.id) ?? new Map();
    const check = verifyTicketToken(request.token, { eventId: event.id, publicKeys });
    if (!check.ok) {
      const outcome = check.reason === "wrong_event" ? "wrong_event" : "invalid";
      await record(outcome, null);
      return respond(outcome, null, null);
    }
    attendeeId = check.payload.attendeeId;
    const [row] = await deps.db
      .select({ attendee: attendees, ticket: tickets })
      .from(attendees)
      .leftJoin(tickets, and(eq(tickets.attendeeId, attendees.id), eq(tickets.status, "active")))
      .where(and(eq(attendees.id, attendeeId), eq(attendees.eventId, event.id)));
    const valid =
      row?.attendee.status === "active" &&
      row.ticket !== null &&
      row.ticket.keyVersion === check.payload.keyVersion &&
      bytesEqual(row.ticket.nonce, check.payload.nonce);
    if (!row || !valid) {
      // Genuine signature but superseded, revoked or cancelled.
      await record("revoked", row ? attendeeId : null);
      return respond("revoked", null, null);
    }
    ticketId = row.ticket!.id;
  } else {
    attendeeId = request.attendeeId;
    const [row] = await deps.db
      .select({ attendee: attendees, ticket: tickets })
      .from(attendees)
      .leftJoin(tickets, and(eq(tickets.attendeeId, attendees.id), eq(tickets.status, "active")))
      .where(and(eq(attendees.id, attendeeId), eq(attendees.eventId, event.id)));
    if (!row) {
      await record("invalid", null);
      return respond("invalid", null, null);
    }
    // Pending guests (invitation not sent yet) may enter; revoked or cancelled ones may not.
    if (row.attendee.status !== "active" || (!row.ticket && !row.attendee.invitationPending)) {
      await record("revoked", attendeeId);
      return respond("revoked", null, null);
    }
    ticketId = row.ticket?.id ?? null;
  }

  const [attendee] = await deps.db
    .select({ id: attendees.id, name: attendees.name })
    .from(attendees)
    .where(eq(attendees.id, attendeeId));

  // The UNIQUE (event_id, attendee_id) constraint decides races: one insert wins.
  const [inserted] = await deps.db
    .insert(checkIns)
    .values({
      eventId: event.id,
      attendeeId,
      organizationId: event.organizationId,
      ticketId,
      scannedBy: user.id,
      clientCheckInId: request.clientCheckInId,
      deviceId: request.deviceId ?? null,
      method: request.method,
      mode: "online",
      scannedAt: now,
      receivedAt: now,
    })
    .onConflictDoNothing()
    .returning();
  if (inserted) {
    await record("valid", attendeeId);
    return respond("valid", attendee!, inserted.scannedAt);
  }

  const [existing] = await deps.db
    .select()
    .from(checkIns)
    .where(and(eq(checkIns.eventId, event.id), eq(checkIns.attendeeId, attendeeId)));
  if (existing?.clientCheckInId === request.clientCheckInId) {
    return respond("valid", attendee!, existing.scannedAt); // concurrent retry of the same scan
  }
  await record("already_used", attendeeId);
  return respond("already_used", attendee!, existing?.scannedAt ?? null);
}

export async function scanContext(
  deps: ServiceDeps,
  userId: string,
  eventId: string,
): Promise<ScanContext> {
  const { event, role } = await findScannableEvent(deps.db, userId, eventId);
  const { opensAt, closesAt } = checkInWindow(event);
  return {
    event: {
      id: event.id,
      name: event.name,
      startsAt: event.startsAt.toISOString(),
      timezone: event.timezone,
      venueName: event.venueName,
      status: event.status,
    },
    window: { opensAt: opensAt.toISOString(), closesAt: closesAt.toISOString() },
    role,
    counts: await counts(deps.db, event.id),
  };
}

function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/** Manual check-in search for scanners: minimal data, partial email (maintainer decision). */
export async function searchForScan(
  deps: ServiceDeps,
  userId: string,
  eventId: string,
  q: string,
): Promise<ScanSearchResult> {
  const { event } = await findScannableEvent(deps.db, userId, eventId);
  const pattern = likePattern(q);
  const rows = await deps.db
    .select({
      id: attendees.id,
      name: attendees.name,
      email: attendees.email,
      checkedInAt: checkIns.scannedAt,
    })
    .from(attendees)
    .leftJoin(checkIns, eq(checkIns.attendeeId, attendees.id))
    .where(
      and(
        eq(attendees.eventId, event.id),
        eq(attendees.status, "active"),
        or(ilike(attendees.name, pattern), ilike(attendees.email, pattern)),
      ),
    )
    .orderBy(asc(attendees.name))
    .limit(20);
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    maskedEmail: maskEmail(row.email),
    checkedInAt: row.checkedInAt?.toISOString() ?? null,
  }));
}

/** Organizers only (maintainer decision): removes a mistaken check-in, recorded in the audit log. */
export async function undoCheckIn(
  deps: ServiceDeps,
  userId: string,
  eventId: string,
  attendeeId: string,
): Promise<void> {
  await deps.db.transaction(async (tx) => {
    const event = await findManagedEvent(tx, userId, eventId);
    const [removed] = await tx
      .delete(checkIns)
      .where(and(eq(checkIns.eventId, eventId), eq(checkIns.attendeeId, attendeeId)))
      .returning({ id: checkIns.id });
    if (!removed) throw new ApiError(404, "not_found");
    await audit(tx, {
      organizationId: event.organizationId,
      actorUserId: userId,
      eventId,
      action: "check_in.undo",
      entityType: "attendee",
      entityId: attendeeId,
    });
  });
}

export async function eventStats(
  deps: ServiceDeps,
  userId: string,
  eventId: string,
): Promise<EventStats> {
  const event = await findManagedEvent(deps.db, userId, eventId);
  const [{ checkedIn, registered }, [pending], attempts, recent] = await Promise.all([
    counts(deps.db, event.id),
    deps.db
      .select({ value: count() })
      .from(attendees)
      .where(
        and(
          eq(attendees.eventId, event.id),
          eq(attendees.status, "active"),
          eq(attendees.invitationPending, true),
        ),
      ),
    deps.db
      .select({ outcome: checkInAttempts.outcome, value: count() })
      .from(checkInAttempts)
      .where(eq(checkInAttempts.eventId, event.id))
      .groupBy(checkInAttempts.outcome),
    deps.db
      .select({
        attendeeId: checkIns.attendeeId,
        name: attendees.name,
        checkedInAt: checkIns.scannedAt,
        method: checkIns.method,
        scannedBy: users.name,
      })
      .from(checkIns)
      .innerJoin(attendees, eq(attendees.id, checkIns.attendeeId))
      .leftJoin(users, eq(users.id, checkIns.scannedBy))
      .where(eq(checkIns.eventId, event.id))
      .orderBy(desc(checkIns.scannedAt))
      .limit(20),
  ]);
  const byOutcome = (...outcomes: CheckInOutcome[]) =>
    attempts
      .filter((a) => outcomes.includes(a.outcome as CheckInOutcome))
      .reduce((sum, a) => sum + a.value, 0);
  return {
    registered,
    checkedIn,
    notCheckedIn: Math.max(0, registered - checkedIn),
    pendingInvitations: pending?.value ?? 0,
    repeatedScans: byOutcome("already_used"),
    rejectedScans: byOutcome("invalid", "wrong_event", "revoked", "outside_window"),
    recent: recent.map((r) => ({ ...r, checkedInAt: r.checkedInAt.toISOString() })),
  };
}

/** CSV export of the guest list with check-in times (organizers only). */
export async function exportAttendeesCsv(
  deps: ServiceDeps,
  userId: string,
  eventId: string,
): Promise<{ filename: string; csv: string }> {
  const event = await findManagedEvent(deps.db, userId, eventId);
  const rows = await deps.db
    .select({
      name: attendees.name,
      email: attendees.email,
      status: attendees.status,
      source: attendees.source,
      registeredAt: attendees.createdAt,
      checkedInAt: checkIns.scannedAt,
    })
    .from(attendees)
    .leftJoin(checkIns, eq(checkIns.attendeeId, attendees.id))
    .where(eq(attendees.eventId, event.id))
    .orderBy(asc(attendees.createdAt));
  const csv = toCsv([
    ["name", "email", "status", "source", "registered_at", "checked_in_at"],
    ...rows.map((r) => [
      r.name,
      r.email,
      r.status,
      r.source,
      r.registeredAt.toISOString(),
      r.checkedInAt?.toISOString() ?? "",
    ]),
  ]);
  return { filename: `${event.slug}-attendees.csv`, csv };
}
