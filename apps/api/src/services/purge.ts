// SPDX-License-Identifier: AGPL-3.0-or-later
// Event data purge (ADR-0011): removes every piece of personal data tied to an event and keeps
// only its totals. Irreversible; owners and admins only; audited.
import type { Event } from "@pasalista/core";
import { schema } from "@pasalista/db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { ApiError } from "../errors.ts";
import { audit } from "./audit.ts";
import { nowOf, type ServiceDeps } from "./context.ts";
import { eventCounts, findManagedEvent, toEventDto } from "./events.ts";

const {
  attendees,
  checkInAttempts,
  checkIns,
  emailOutbox,
  events,
  eventSigningKeys,
  eventStaff,
  organizationMembers,
  staffInvitations,
} = schema;

export async function purgeEventData(
  deps: ServiceDeps,
  userId: string,
  eventId: string,
  confirmSlug: string,
): Promise<Event> {
  return deps.db.transaction(async (tx) => {
    const event = await findManagedEvent(tx, userId, eventId, { forUpdate: true });
    const [membership] = await tx
      .select({ role: organizationMembers.role })
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, event.organizationId),
          eq(organizationMembers.userId, userId),
        ),
      );
    if (!membership || !["owner", "admin"].includes(membership.role)) {
      throw new ApiError(403, "forbidden", "Only owners and admins can purge event data");
    }
    if (event.purgedAt) throw new ApiError(409, "invalid_state", "Already purged");
    if (event.status !== "closed") {
      throw new ApiError(409, "invalid_state", "Close the event before purging its data");
    }
    if (confirmSlug !== event.slug) {
      throw new ApiError(400, "validation_failed", undefined, [
        { path: ["confirmSlug"], message: "Does not match the event slug" },
      ]);
    }

    const totals = (await eventCounts(tx, [event.id])).get(event.id)!;

    // Emails queued before outbox rows carried the event id are matched by recipient.
    const recipients = [
      ...(await tx
        .select({ email: attendees.email })
        .from(attendees)
        .where(eq(attendees.eventId, event.id))),
      ...(await tx
        .select({ email: staffInvitations.email })
        .from(staffInvitations)
        .where(eq(staffInvitations.eventId, event.id))),
    ].map((r) => r.email);
    await tx.delete(emailOutbox).where(eq(emailOutbox.eventId, event.id));
    if (recipients.length > 0) {
      await tx
        .delete(emailOutbox)
        .where(
          and(
            eq(emailOutbox.organizationId, event.organizationId),
            isNull(emailOutbox.eventId),
            inArray(emailOutbox.toEmail, recipients),
          ),
        );
    }

    await tx.delete(checkInAttempts).where(eq(checkInAttempts.eventId, event.id));
    await tx.delete(checkIns).where(eq(checkIns.eventId, event.id));
    await tx.delete(attendees).where(eq(attendees.eventId, event.id)); // cascades to tickets
    await tx.delete(staffInvitations).where(eq(staffInvitations.eventId, event.id));
    await tx.delete(eventStaff).where(eq(eventStaff.eventId, event.id));
    // Keys only verified this event's tickets, which no longer exist.
    await tx.delete(eventSigningKeys).where(eq(eventSigningKeys.eventId, event.id));

    const [purged] = await tx
      .update(events)
      .set({
        purgedAt: nowOf(deps),
        finalRegisteredCount: totals.registered,
        finalCheckedInCount: totals.checkedIn,
        registrationFields: [],
      })
      .where(eq(events.id, event.id))
      .returning();

    await audit(tx, {
      organizationId: event.organizationId,
      actorUserId: userId,
      eventId: event.id,
      action: "event.purge",
      entityType: "event",
      entityId: event.id,
      metadata: { registered: totals.registered, checkedIn: totals.checkedIn },
    });
    return toEventDto(purged!, totals);
  });
}
