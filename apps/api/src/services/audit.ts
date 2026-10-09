// SPDX-License-Identifier: AGPL-3.0-or-later
import { schema } from "@pasalista/db";
import type { Executor } from "./context.ts";

export type AuditAction =
  | "event.publish"
  | "event.close"
  | "event.delete"
  | "event.key_rotate"
  | "guests.add"
  | "guests.import"
  | "invitations.send"
  | "ticket.reissue"
  | "ticket.resend"
  | "ticket.revoke"
  | "attendee.cancel"
  | "check_in.undo"
  | "staff.invite"
  | "staff.invitation_revoke"
  | "staff.remove";

/**
 * Records an organizer action. Only ids, counts and enums go into `metadata`: never names,
 * emails, tokens or keys.
 */
export async function audit(
  db: Executor,
  entry: {
    organizationId: string;
    actorUserId: string;
    eventId?: string | null;
    action: AuditAction;
    entityType: "event" | "attendee" | "ticket" | "check_in" | "staff" | "staff_invitation";
    entityId?: string | null;
    metadata?: Record<string, string | number | boolean | null>;
  },
): Promise<void> {
  await db.insert(schema.auditLog).values({
    organizationId: entry.organizationId,
    actorUserId: entry.actorUserId,
    eventId: entry.eventId ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    metadata: entry.metadata ?? {},
  });
}
