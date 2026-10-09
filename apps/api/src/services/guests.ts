// SPDX-License-Identifier: AGPL-3.0-or-later
// Organizer operations on an event's guest list (ADR-0008).
import {
  planGuestImport,
  type Attendee,
  type AttendeeList,
  type AttendeeListQuery,
  type GuestInput,
  type ImportReport,
  type ImportRequest,
} from "@pasalista/core";
import { schema } from "@pasalista/db";
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  or,
  type SQL,
} from "drizzle-orm";
import { newAccessToken } from "../crypto/key-encryption.ts";
import { ApiError } from "../errors.ts";
import { nowOf, type ServiceDeps, type Transaction } from "./context.ts";
import { assertNotPurged, countActiveAttendees, findManagedEvent } from "./events.ts";
import { audit, type AuditAction } from "./audit.ts";
import { issueTickets, resendTicketEmail } from "./ticket-issuer.ts";

const { attendees, checkIns, tickets } = schema;

type EventRow = typeof schema.events.$inferSelect;

/** Escapes LIKE wildcards so user input matches literally. */
function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

function assertCapacity(event: EventRow, activeCount: number, adding: number) {
  if (event.capacity !== null && activeCount + adding > event.capacity) {
    const available = Math.max(0, event.capacity - activeCount);
    throw new ApiError(409, "event_full", `Only ${available} spots available`);
  }
}

// --- Listing -------------------------------------------------------------------------------

export async function listGuests(
  deps: ServiceDeps,
  userId: string,
  eventId: string,
  query: AttendeeListQuery,
): Promise<AttendeeList> {
  await findManagedEvent(deps.db, userId, eventId);

  // Latest ticket per attendee (any status).
  const latest = deps.db
    .selectDistinctOn([tickets.attendeeId], {
      attendeeId: tickets.attendeeId,
      status: tickets.status,
    })
    .from(tickets)
    .where(eq(tickets.eventId, eventId))
    .orderBy(tickets.attendeeId, desc(tickets.issuedAt))
    .as("latest");

  const filters: SQL[] = [eq(attendees.eventId, eventId)];
  if (query.q) {
    const pattern = likePattern(query.q);
    filters.push(or(ilike(attendees.name, pattern), ilike(attendees.email, pattern))!);
  }
  if (query.status) filters.push(eq(attendees.status, query.status));
  if (query.ticket === "pending") filters.push(eq(attendees.invitationPending, true));
  else if (query.ticket) filters.push(eq(latest.status, query.ticket));
  if (query.checkedIn === "yes") filters.push(isNotNull(checkIns.id));
  if (query.checkedIn === "no") filters.push(isNull(checkIns.id));
  const where = and(...filters);

  const [rows, [totals], [pending]] = await Promise.all([
    deps.db
      .select({ attendee: attendees, ticketStatus: latest.status, checkedInAt: checkIns.scannedAt })
      .from(attendees)
      .leftJoin(latest, eq(latest.attendeeId, attendees.id))
      .leftJoin(checkIns, eq(checkIns.attendeeId, attendees.id))
      .where(where)
      .orderBy(asc(attendees.createdAt), asc(attendees.id))
      .limit(query.limit)
      .offset(query.offset),
    deps.db
      .select({ value: count() })
      .from(attendees)
      .leftJoin(latest, eq(latest.attendeeId, attendees.id))
      .leftJoin(checkIns, eq(checkIns.attendeeId, attendees.id))
      .where(where),
    deps.db
      .select({ value: count() })
      .from(attendees)
      .where(
        and(
          eq(attendees.eventId, eventId),
          eq(attendees.status, "active"),
          eq(attendees.invitationPending, true),
        ),
      ),
  ]);

  return {
    items: rows.map(({ attendee, ticketStatus, checkedInAt }): Attendee => ({
      id: attendee.id,
      name: attendee.name,
      email: attendee.email,
      status: attendee.status,
      source: attendee.source,
      answers: attendee.answers,
      ticketStatus: attendee.invitationPending ? null : (ticketStatus ?? null),
      checkedInAt: checkedInAt?.toISOString() ?? null,
      createdAt: attendee.createdAt.toISOString(),
    })),
    total: totals?.value ?? 0,
    pendingCount: pending?.value ?? 0,
  };
}

// --- Adding guests -------------------------------------------------------------------------

/**
 * Adds guests without emailing them (maintainer decision: invitations go out with "Send
 * invitations"). Existing active guests are skipped; cancelled ones are reactivated.
 */
async function addGuests(
  deps: ServiceDeps,
  tx: Transaction,
  event: EventRow,
  guests: (GuestInput & { line?: number })[],
  source: "manual" | "import",
): Promise<{ added: number; alreadyOnList: (GuestInput & { line?: number })[] }> {
  assertNotPurged(event);
  const emails = guests.map((g) => g.email);
  const existing =
    emails.length === 0
      ? []
      : await tx
          .select({ id: attendees.id, email: attendees.email, status: attendees.status })
          .from(attendees)
          .where(and(eq(attendees.eventId, event.id), inArray(attendees.email, emails)));
  const byEmail = new Map(existing.map((row) => [row.email, row]));

  const alreadyOnList = guests.filter((g) => byEmail.get(g.email)?.status === "active");
  const reactivate = guests.filter((g) => byEmail.get(g.email)?.status === "cancelled");
  const fresh = guests.filter((g) => !byEmail.has(g.email));

  assertCapacity(event, await countActiveAttendees(tx, event.id), reactivate.length + fresh.length);

  for (const guest of reactivate) {
    await tx
      .update(attendees)
      .set({
        name: guest.name,
        locale: guest.locale,
        status: "active",
        cancelledAt: null,
        invitationPending: true,
      })
      .where(eq(attendees.id, byEmail.get(guest.email)!.id));
  }
  const rows = fresh.map((guest) => ({
    eventId: event.id,
    organizationId: event.organizationId,
    name: guest.name,
    email: guest.email,
    locale: guest.locale,
    source,
    invitationPending: true,
    // Unusable until the invitation is sent and a real link is issued.
    ticketAccessHash: newAccessToken().hash,
  }));
  for (let i = 0; i < rows.length; i += 500) {
    await tx.insert(attendees).values(rows.slice(i, i + 500));
  }
  return { added: reactivate.length + fresh.length, alreadyOnList };
}

export async function addGuest(
  deps: ServiceDeps,
  userId: string,
  eventId: string,
  guest: GuestInput,
): Promise<void> {
  await deps.db.transaction(async (tx) => {
    const event = await findManagedEvent(tx, userId, eventId, { forUpdate: true });
    const { alreadyOnList } = await addGuests(deps, tx, event, [guest], "manual");
    if (alreadyOnList.length > 0) throw new ApiError(409, "already_registered");
    await audit(tx, {
      organizationId: event.organizationId,
      actorUserId: userId,
      eventId,
      action: "guests.add",
      entityType: "event",
      entityId: eventId,
    });
  });
}

export async function importGuests(
  deps: ServiceDeps,
  userId: string,
  eventId: string,
  request: ImportRequest,
): Promise<ImportReport> {
  const plan = planGuestImport(request.rows, request.defaultLocale);
  return deps.db.transaction(async (tx) => {
    const event = await findManagedEvent(tx, userId, eventId, { forUpdate: true });
    const { added, alreadyOnList } = await addGuests(deps, tx, event, plan.guests, "import");
    const skipped = [
      ...plan.skipped,
      ...alreadyOnList.map((g) => ({
        line: g.line ?? 0,
        email: g.email,
        problem: "already_on_list" as const,
      })),
    ].sort((a, b) => a.line - b.line);
    await audit(tx, {
      organizationId: event.organizationId,
      actorUserId: userId,
      eventId,
      action: "guests.import",
      entityType: "event",
      entityId: eventId,
      metadata: { added, skipped: skipped.length },
    });
    return { added, skipped };
  });
}

// --- Sending -------------------------------------------------------------------------------

/** Issues tickets for every pending guest and queues their emails (one transaction). */
export async function sendPendingInvitations(
  deps: ServiceDeps,
  userId: string,
  eventId: string,
): Promise<number> {
  return deps.db.transaction(async (tx) => {
    const event = await findManagedEvent(tx, userId, eventId, { forUpdate: true });
    assertNotPurged(event);
    if (event.status !== "published") {
      throw new ApiError(409, "invalid_state", "Publish the event before sending invitations");
    }
    const pending = await tx
      .select()
      .from(attendees)
      .where(
        and(
          eq(attendees.eventId, eventId),
          eq(attendees.status, "active"),
          eq(attendees.invitationPending, true),
        ),
      )
      .orderBy(asc(attendees.createdAt))
      .for("update");
    const sent = await issueTickets(deps, tx, event, pending, "invitation");
    await audit(tx, {
      organizationId: event.organizationId,
      actorUserId: userId,
      eventId,
      action: "invitations.send",
      entityType: "event",
      entityId: eventId,
      metadata: { sent },
    });
    return sent;
  });
}

// --- Per-attendee actions ------------------------------------------------------------------

function auditAttendee(
  tx: Transaction,
  event: { id: string; organizationId: string },
  userId: string,
  action: AuditAction,
  attendeeId: string,
) {
  return audit(tx, {
    organizationId: event.organizationId,
    actorUserId: userId,
    eventId: event.id,
    action,
    entityType: "attendee",
    entityId: attendeeId,
  });
}

async function findManagedAttendee(tx: Transaction, userId: string, attendeeId: string) {
  const [row] = await tx.select().from(attendees).where(eq(attendees.id, attendeeId)).for("update");
  if (!row) throw new ApiError(404, "not_found");
  const event = await findManagedEvent(tx, userId, row.eventId); // 404 when not a member
  return { attendee: row, event };
}

/** Sends the invitation of one pending guest, or a brand new ticket (new QR) to anyone active. */
export async function reissueTicket(
  deps: ServiceDeps,
  userId: string,
  attendeeId: string,
): Promise<void> {
  await deps.db.transaction(async (tx) => {
    const { attendee, event } = await findManagedAttendee(tx, userId, attendeeId);
    if (attendee.status !== "active")
      throw new ApiError(409, "invalid_state", "Attendee is cancelled");
    const variant = attendee.source === "open_registration" ? "registration" : "invitation";
    await issueTickets(deps, tx, event, [attendee], variant);
    await auditAttendee(tx, event, userId, "ticket.reissue", attendee.id);
  });
}

/** Emails the current ticket again (same QR, new link) for guests who lost the email. */
export async function resendTicket(
  deps: ServiceDeps,
  userId: string,
  attendeeId: string,
): Promise<void> {
  await deps.db.transaction(async (tx) => {
    const { attendee, event } = await findManagedAttendee(tx, userId, attendeeId);
    const [ticket] = await tx
      .select()
      .from(tickets)
      .where(and(eq(tickets.attendeeId, attendeeId), eq(tickets.status, "active")));
    if (attendee.status !== "active" || !ticket) {
      throw new ApiError(409, "invalid_state", "No valid ticket to resend");
    }
    await resendTicketEmail(deps, tx, event, attendee, ticket);
    await auditAttendee(tx, event, userId, "ticket.resend", attendee.id);
  });
}

export async function revokeTicket(
  deps: ServiceDeps,
  userId: string,
  attendeeId: string,
): Promise<void> {
  await deps.db.transaction(async (tx) => {
    const { event } = await findManagedAttendee(tx, userId, attendeeId);
    await tx
      .update(tickets)
      .set({ status: "revoked", revokedAt: nowOf(deps), revokedReason: "revoked_by_organizer" })
      .where(and(eq(tickets.attendeeId, attendeeId), eq(tickets.status, "active")));
    await auditAttendee(tx, event, userId, "ticket.revoke", attendeeId);
  });
}

export async function cancelAttendee(
  deps: ServiceDeps,
  tx: Transaction,
  attendeeId: string,
  reason: string,
): Promise<void> {
  const now = nowOf(deps);
  await tx
    .update(attendees)
    .set({ status: "cancelled", cancelledAt: now, invitationPending: false })
    .where(eq(attendees.id, attendeeId));
  await tx
    .update(tickets)
    .set({ status: "revoked", revokedAt: now, revokedReason: reason })
    .where(and(eq(tickets.attendeeId, attendeeId), eq(tickets.status, "active")));
}

export async function cancelRegistration(
  deps: ServiceDeps,
  userId: string,
  attendeeId: string,
): Promise<void> {
  await deps.db.transaction(async (tx) => {
    const { attendee, event } = await findManagedAttendee(tx, userId, attendeeId);
    if (attendee.status === "cancelled") return;
    await cancelAttendee(deps, tx, attendee.id, "cancelled_by_organizer");
    await auditAttendee(tx, event, userId, "attendee.cancel", attendee.id);
  });
}
