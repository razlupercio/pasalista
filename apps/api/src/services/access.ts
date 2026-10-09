// SPDX-License-Identifier: AGPL-3.0-or-later
import { schema } from "@pasalista/db";
import { and, eq } from "drizzle-orm";
import { ApiError } from "../errors.ts";
import type { Executor } from "./context.ts";

const { events, eventStaff, organizationMembers } = schema;

export type ScanRole = "organizer" | "staff";

/**
 * Loads an event the user may scan for: members of the owning organization (organizers) and
 * staff assigned to the event. Everyone else gets 404.
 */
export async function findScannableEvent(
  db: Executor,
  userId: string,
  eventId: string,
): Promise<{ event: typeof events.$inferSelect; role: ScanRole }> {
  const [row] = await db
    .select({ event: events, memberId: organizationMembers.id, staffUserId: eventStaff.userId })
    .from(events)
    .leftJoin(
      organizationMembers,
      and(
        eq(organizationMembers.organizationId, events.organizationId),
        eq(organizationMembers.userId, userId),
      ),
    )
    .leftJoin(eventStaff, and(eq(eventStaff.eventId, events.id), eq(eventStaff.userId, userId)))
    .where(eq(events.id, eventId));
  if (!row || (!row.memberId && !row.staffUserId)) throw new ApiError(404, "not_found");
  return { event: row.event, role: row.memberId ? "organizer" : "staff" };
}
