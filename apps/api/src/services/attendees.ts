// SPDX-License-Identifier: AGPL-3.0-or-later
// Public registration and the attendee's "my ticket" page. Organizer operations live in guests.ts.
import {
  validateAnswers,
  type PublicEvent,
  type RegistrationInput,
  type RegistrationState,
  type TicketView,
} from "@pasalista/core";
import { schema } from "@pasalista/db";
import { and, desc, eq } from "drizzle-orm";
import { hashAccessToken, newAccessToken } from "../crypto/key-encryption.ts";
import { ApiError } from "../errors.ts";
import { nowOf, type Executor, type ServiceDeps } from "./context.ts";
import { countActiveAttendees, isPast } from "./events.ts";
import { cancelAttendee } from "./guests.ts";
import { issueTickets, signExistingTicket } from "./ticket-issuer.ts";

const { attendees, events, organizations, tickets } = schema;

type EventRow = typeof events.$inferSelect;
type TicketRow = typeof tickets.$inferSelect;

// --- Registration state ------------------------------------------------------------------

export function registrationState(
  deps: ServiceDeps,
  event: EventRow,
  activeCount: number,
): RegistrationState {
  if (event.status !== "published" || isPast(deps, event)) return "closed";
  if (event.registrationMode === "closed") return "invitation_only";
  if (event.registrationDeadline && event.registrationDeadline <= nowOf(deps)) {
    return "deadline_passed";
  }
  if (event.capacity !== null && activeCount >= event.capacity) return "full";
  return "open";
}

export async function organizerName(db: Executor, organizationId: string): Promise<string> {
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
            ticketAccessHash: newAccessToken().hash, // replaced when the ticket is issued
          })
          .returning();
    await issueTickets(deps, tx, event, [attendee!], "registration");
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
  // Pending guests hold a placeholder hash that no token maps to; treat them as unknown too.
  if (!row || row.attendee.invitationPending) throw new ApiError(404, "not_found");
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
      qrToken: valid && ticket ? await signExistingTicket(deps, deps.db, ticket) : null,
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

export async function cancelOwnRegistration(deps: ServiceDeps, accessToken: string): Promise<void> {
  await deps.db.transaction(async (tx) => {
    const { attendee } = await findByAccessToken(tx, accessToken, true);
    if (attendee.status === "cancelled") return; // idempotent
    await cancelAttendee(deps, tx, attendee.id, "cancelled_by_attendee");
  });
}
