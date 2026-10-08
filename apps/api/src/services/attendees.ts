// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  generateTicketNonce,
  signTicketToken,
  validateAnswers,
  type Attendee,
  type PublicEvent,
  type RegistrationInput,
  type RegistrationState,
  type TicketView,
} from "@pasalista/core";
import { schema } from "@pasalista/db";
import { and, asc, desc, eq } from "drizzle-orm";
import { hashAccessToken, newAccessToken } from "../crypto/key-encryption.ts";
import { enqueueEmail } from "../email/outbox.ts";
import { ApiError } from "../errors.ts";
import { nowOf, type Executor, type ServiceDeps, type Transaction } from "./context.ts";
import { countActiveAttendees, findManagedEvent, isPast } from "./events.ts";
import { activeKeyVersion, loadSecretKey } from "./signing-keys.ts";

const { attendees, events, organizations, tickets } = schema;

type EventRow = typeof events.$inferSelect;
type AttendeeRow = typeof attendees.$inferSelect;
type TicketRow = typeof tickets.$inferSelect;

// --- Registration state ------------------------------------------------------------------

export function registrationState(
  deps: ServiceDeps,
  event: EventRow,
  activeCount: number,
): RegistrationState {
  if (event.status !== "published" || isPast(deps, event)) return "closed";
  if (event.registrationMode === "closed") return "invitation_only";
  if (event.registrationDeadline && event.registrationDeadline <= nowOf(deps))
    return "deadline_passed";
  if (event.capacity !== null && activeCount >= event.capacity) return "full";
  return "open";
}

async function organizerName(db: Executor, organizationId: string): Promise<string> {
  const [org] = await db
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  return org?.name ?? "";
}

function toPublicEvent(event: EventRow, organizer: string, state: RegistrationState): PublicEvent {
  return {
    slug: event.slug,
    name: event.name,
    description: event.description,
    startsAt: event.startsAt.toISOString(),
    endsAt: event.endsAt?.toISOString() ?? null,
    timezone: event.timezone,
    venueName: event.venueName,
    venueAddress: event.venueAddress,
    organizerName: organizer,
    registrationState: state,
    registrationDeadline: event.registrationDeadline?.toISOString() ?? null,
    registrationFields: event.registrationFields,
  };
}

/** Published and closed events are public; drafts do not exist for the public. */
export async function getPublicEvent(deps: ServiceDeps, slug: string): Promise<PublicEvent> {
  const [event] = await deps.db.select().from(events).where(eq(events.slug, slug));
  if (!event || event.status === "draft") throw new ApiError(404, "not_found");
  const [organizer, activeCount] = await Promise.all([
    organizerName(deps.db, event.organizationId),
    countActiveAttendees(deps.db, event.id),
  ]);
  return toPublicEvent(event, organizer, registrationState(deps, event, activeCount));
}

// --- Tickets -------------------------------------------------------------------------------

/**
 * Issues a new ticket (fresh nonce, current key version) and a new "my ticket" link, then
 * queues the ticket email in the same transaction. Any previous active ticket is superseded.
 */
async function issueTicket(
  deps: ServiceDeps,
  tx: Transaction,
  event: EventRow,
  attendee: AttendeeRow,
): Promise<void> {
  await tx
    .update(tickets)
    .set({ status: "superseded", revokedAt: nowOf(deps), revokedReason: "reissued" })
    .where(and(eq(tickets.attendeeId, attendee.id), eq(tickets.status, "active")));

  const keyVersion = await activeKeyVersion(tx, event.id);
  const nonce = generateTicketNonce();
  await tx
    .insert(tickets)
    .values({ attendeeId: attendee.id, eventId: event.id, keyVersion, nonce });

  const access = newAccessToken();
  await tx
    .update(attendees)
    .set({ ticketAccessHash: access.hash })
    .where(eq(attendees.id, attendee.id));

  const qrToken = await signTicket(deps, tx, {
    eventId: event.id,
    attendeeId: attendee.id,
    keyVersion,
    nonce,
  });
  const dateFormat = new Intl.DateTimeFormat(attendee.locale, {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: event.timezone,
  });
  await enqueueEmail(tx, {
    kind: "ticket",
    to: attendee.email,
    locale: attendee.locale,
    organizationId: event.organizationId,
    payload: {
      name: attendee.name,
      eventName: event.name,
      when: dateFormat.format(event.startsAt),
      where: [event.venueName, event.venueAddress].filter(Boolean).join(", "),
      url: `${deps.publicUrl}/${attendee.locale}/t/${access.token}`,
      qrToken,
    },
  });
}

async function signTicket(
  deps: ServiceDeps,
  db: Executor,
  ticket: { eventId: string; attendeeId: string; keyVersion: number; nonce: Uint8Array },
): Promise<string> {
  const secretKey = await loadSecretKey(db, deps.kek, ticket.eventId, ticket.keyVersion);
  try {
    return signTicketToken(ticket, secretKey);
  } finally {
    secretKey.fill(0);
  }
}

// --- Public registration -------------------------------------------------------------------

export async function registerAttendee(
  deps: ServiceDeps,
  slug: string,
  input: RegistrationInput,
): Promise<void> {
  await deps.db.transaction(async (tx) => {
    // Lock the event row: registrations for one event are serialized, so the capacity check
    // and the insert cannot race.
    const [event] = await tx.select().from(events).where(eq(events.slug, slug)).for("update");
    if (!event || event.status === "draft") throw new ApiError(404, "not_found");

    const activeCount = await countActiveAttendees(tx, event.id);
    const state = registrationState(deps, event, activeCount);
    if (state === "full") throw new ApiError(409, "event_full");
    if (state !== "open") throw new ApiError(403, "registration_closed", state);

    const checked = validateAnswers(event.registrationFields, input.answers);
    if (!checked.ok) {
      throw new ApiError(
        400,
        "validation_failed",
        undefined,
        checked.issues.map((issue) => ({ path: ["answers", issue.key], message: issue.problem })),
      );
    }

    const [existing] = await tx
      .select()
      .from(attendees)
      .where(and(eq(attendees.eventId, event.id), eq(attendees.email, input.email)));
    // Maintainer decision (ADR-0007): an already registered email gets an explicit error.
    if (existing?.status === "active") throw new ApiError(409, "already_registered");

    const values = {
      name: input.name,
      locale: input.locale,
      answers: checked.answers,
      status: "active" as const,
      cancelledAt: null,
    };
    const placeholderHash = newAccessToken().hash; // replaced by issueTicket
    const [attendee] = existing
      ? await tx.update(attendees).set(values).where(eq(attendees.id, existing.id)).returning()
      : await tx
          .insert(attendees)
          .values({
            ...values,
            eventId: event.id,
            organizationId: event.organizationId,
            email: input.email,
            source: "open_registration",
            ticketAccessHash: placeholderHash,
          })
          .returning();
    await issueTicket(deps, tx, event, attendee!);
  });
}

// --- "My ticket" (attendee, secret link) ---------------------------------------------------

async function findByAccessToken(db: Executor, accessToken: string, forUpdate = false) {
  const query = db
    .select({ attendee: attendees, event: events })
    .from(attendees)
    .innerJoin(events, eq(events.id, attendees.eventId))
    .where(eq(attendees.ticketAccessHash, hashAccessToken(accessToken)));
  const [row] = forUpdate ? await query.for("update", { of: attendees }) : await query;
  if (!row) throw new ApiError(404, "not_found");
  return row;
}

async function latestTicket(db: Executor, attendeeId: string): Promise<TicketRow | undefined> {
  const [ticket] = await db
    .select()
    .from(tickets)
    .where(eq(tickets.attendeeId, attendeeId))
    .orderBy(desc(tickets.issuedAt))
    .limit(1);
  return ticket;
}

export async function viewTicket(deps: ServiceDeps, accessToken: string): Promise<TicketView> {
  const { attendee, event } = await findByAccessToken(deps.db, accessToken);
  const [ticket, organizer] = await Promise.all([
    latestTicket(deps.db, attendee.id),
    organizerName(deps.db, event.organizationId),
  ]);
  const valid = attendee.status === "active" && ticket?.status === "active";
  return {
    attendee: { name: attendee.name, status: attendee.status },
    event: {
      slug: event.slug,
      name: event.name,
      startsAt: event.startsAt.toISOString(),
      endsAt: event.endsAt?.toISOString() ?? null,
      timezone: event.timezone,
      venueName: event.venueName,
      venueAddress: event.venueAddress,
      organizerName: organizer,
    },
    ticket: {
      status: ticket?.status ?? "revoked",
      qrToken:
        valid && ticket
          ? await signTicket(deps, deps.db, {
              eventId: event.id,
              attendeeId: attendee.id,
              keyVersion: ticket.keyVersion,
              nonce: ticket.nonce,
            })
          : null,
    },
  };
}

/** The QR payload behind a valid ticket link, for the PNG endpoint. */
export async function ticketQrToken(
  deps: ServiceDeps,
  accessToken: string,
): Promise<{ token: string; slug: string }> {
  const view = await viewTicket(deps, accessToken);
  if (!view.ticket.qrToken) throw new ApiError(404, "not_found");
  return { token: view.ticket.qrToken, slug: view.event.slug };
}

async function cancelAttendee(
  deps: ServiceDeps,
  tx: Transaction,
  attendeeId: string,
  reason: string,
) {
  const now = nowOf(deps);
  await tx
    .update(attendees)
    .set({ status: "cancelled", cancelledAt: now })
    .where(eq(attendees.id, attendeeId));
  await tx
    .update(tickets)
    .set({ status: "revoked", revokedAt: now, revokedReason: reason })
    .where(and(eq(tickets.attendeeId, attendeeId), eq(tickets.status, "active")));
}

export async function cancelOwnRegistration(deps: ServiceDeps, accessToken: string): Promise<void> {
  await deps.db.transaction(async (tx) => {
    const { attendee } = await findByAccessToken(tx, accessToken, true);
    if (attendee.status === "cancelled") return; // idempotent
    await cancelAttendee(deps, tx, attendee.id, "cancelled_by_attendee");
  });
}

// --- Organizer operations ------------------------------------------------------------------

async function findManagedAttendee(tx: Transaction, userId: string, attendeeId: string) {
  const [row] = await tx.select().from(attendees).where(eq(attendees.id, attendeeId)).for("update");
  if (!row) throw new ApiError(404, "not_found");
  const event = await findManagedEvent(tx, userId, row.eventId); // 404 when not a member
  return { attendee: row, event };
}

export async function listAttendees(
  deps: ServiceDeps,
  userId: string,
  eventId: string,
): Promise<Attendee[]> {
  await findManagedEvent(deps.db, userId, eventId);
  const rows = await deps.db
    .select({ attendee: attendees, ticketStatus: tickets.status })
    .from(attendees)
    .leftJoin(tickets, and(eq(tickets.attendeeId, attendees.id), eq(tickets.status, "active")))
    .where(eq(attendees.eventId, eventId))
    .orderBy(asc(attendees.createdAt));
  return rows.map(({ attendee, ticketStatus }) => ({
    id: attendee.id,
    name: attendee.name,
    email: attendee.email,
    status: attendee.status,
    source: attendee.source,
    answers: attendee.answers,
    ticketStatus: ticketStatus ?? (attendee.status === "active" ? "revoked" : null),
    createdAt: attendee.createdAt.toISOString(),
  }));
}

export async function reissueTicket(
  deps: ServiceDeps,
  userId: string,
  attendeeId: string,
): Promise<void> {
  await deps.db.transaction(async (tx) => {
    const { attendee, event } = await findManagedAttendee(tx, userId, attendeeId);
    if (attendee.status !== "active")
      throw new ApiError(409, "invalid_state", "Attendee is cancelled");
    await issueTicket(deps, tx, event, attendee);
  });
}

export async function revokeTicket(
  deps: ServiceDeps,
  userId: string,
  attendeeId: string,
): Promise<void> {
  await deps.db.transaction(async (tx) => {
    await findManagedAttendee(tx, userId, attendeeId);
    await tx
      .update(tickets)
      .set({ status: "revoked", revokedAt: nowOf(deps), revokedReason: "revoked_by_organizer" })
      .where(and(eq(tickets.attendeeId, attendeeId), eq(tickets.status, "active")));
  });
}

export async function cancelRegistration(
  deps: ServiceDeps,
  userId: string,
  attendeeId: string,
): Promise<void> {
  await deps.db.transaction(async (tx) => {
    const { attendee } = await findManagedAttendee(tx, userId, attendeeId);
    if (attendee.status === "cancelled") return;
    await cancelAttendee(deps, tx, attendee.id, "cancelled_by_organizer");
  });
}
