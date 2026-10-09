// SPDX-License-Identifier: AGPL-3.0-or-later
// Event staff: email invitations (single-use, bound to the invited email) and assignments.
import type { AssignedEvent, StaffInvitationPreview, StaffOverview } from "@pasalista/core";
import { schema } from "@pasalista/db";
import { and, asc, desc, eq, gt, isNull } from "drizzle-orm";
import { hashAccessToken, newAccessToken } from "../crypto/key-encryption.ts";
import { enqueueEmail } from "../email/outbox.ts";
import { ApiError } from "../errors.ts";
import { nowOf, type ServiceDeps } from "./context.ts";
import { organizerName } from "./attendees.ts";
import { findManagedEvent } from "./events.ts";

const { eventStaff, events, organizations, staffInvitations, users } = schema;

export const STAFF_INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function getStaff(
  deps: ServiceDeps,
  userId: string,
  eventId: string,
): Promise<StaffOverview> {
  await findManagedEvent(deps.db, userId, eventId);
  const [members, invitations] = await Promise.all([
    deps.db
      .select({
        userId: users.id,
        name: users.name,
        email: users.email,
        addedAt: eventStaff.createdAt,
      })
      .from(eventStaff)
      .innerJoin(users, eq(users.id, eventStaff.userId))
      .where(eq(eventStaff.eventId, eventId))
      .orderBy(asc(eventStaff.createdAt)),
    deps.db
      .select({
        id: staffInvitations.id,
        email: staffInvitations.email,
        expiresAt: staffInvitations.expiresAt,
      })
      .from(staffInvitations)
      .where(
        and(
          eq(staffInvitations.eventId, eventId),
          isNull(staffInvitations.acceptedAt),
          isNull(staffInvitations.revokedAt),
          gt(staffInvitations.expiresAt, nowOf(deps)),
        ),
      )
      .orderBy(desc(staffInvitations.createdAt)),
  ]);
  return {
    members: members.map((m) => ({ ...m, addedAt: m.addedAt.toISOString() })),
    invitations: invitations.map((i) => ({ ...i, expiresAt: i.expiresAt.toISOString() })),
  };
}

export async function inviteStaff(
  deps: ServiceDeps,
  inviter: { id: string; name: string },
  eventId: string,
  input: { email: string; locale: string },
): Promise<void> {
  await deps.db.transaction(async (tx) => {
    const event = await findManagedEvent(tx, inviter.id, eventId, { forUpdate: true });
    const [already] = await tx
      .select({ userId: eventStaff.userId })
      .from(eventStaff)
      .innerJoin(users, eq(users.id, eventStaff.userId))
      .where(and(eq(eventStaff.eventId, eventId), eq(users.email, input.email)));
    if (already) throw new ApiError(409, "conflict", "Already staff for this event");

    const now = nowOf(deps);
    // A new invitation replaces any pending one for the same email.
    await tx
      .update(staffInvitations)
      .set({ revokedAt: now })
      .where(
        and(
          eq(staffInvitations.eventId, eventId),
          eq(staffInvitations.email, input.email),
          isNull(staffInvitations.acceptedAt),
          isNull(staffInvitations.revokedAt),
        ),
      );
    const token = newAccessToken();
    await tx.insert(staffInvitations).values({
      eventId,
      organizationId: event.organizationId,
      email: input.email,
      tokenHash: token.hash,
      invitedBy: inviter.id,
      expiresAt: new Date(now.getTime() + STAFF_INVITATION_TTL_MS),
    });
    await enqueueEmail(tx, {
      kind: "staff_invitation",
      to: input.email,
      locale: input.locale,
      organizationId: event.organizationId,
      payload: {
        inviterName: inviter.name,
        eventName: event.name,
        url: `${deps.publicUrl}/${input.locale}/invitations/staff/${token.token}`,
      },
    });
  });
}

export async function revokeStaffInvitation(
  deps: ServiceDeps,
  userId: string,
  eventId: string,
  invitationId: string,
): Promise<void> {
  await findManagedEvent(deps.db, userId, eventId);
  await deps.db
    .update(staffInvitations)
    .set({ revokedAt: nowOf(deps) })
    .where(
      and(
        eq(staffInvitations.id, invitationId),
        eq(staffInvitations.eventId, eventId),
        isNull(staffInvitations.acceptedAt),
      ),
    );
}

export async function removeStaff(
  deps: ServiceDeps,
  userId: string,
  eventId: string,
  staffUserId: string,
): Promise<void> {
  await findManagedEvent(deps.db, userId, eventId);
  await deps.db
    .delete(eventStaff)
    .where(and(eq(eventStaff.eventId, eventId), eq(eventStaff.userId, staffUserId)));
}

async function findInvitation(deps: ServiceDeps, token: string) {
  const [row] = await deps.db
    .select({
      invitation: staffInvitations,
      eventName: events.name,
      organizationId: events.organizationId,
    })
    .from(staffInvitations)
    .innerJoin(events, eq(events.id, staffInvitations.eventId))
    .where(eq(staffInvitations.tokenHash, hashAccessToken(token)));
  if (!row) throw new ApiError(404, "not_found");
  const { invitation } = row;
  const state: StaffInvitationPreview["state"] = invitation.acceptedAt
    ? "accepted"
    : invitation.revokedAt
      ? "revoked"
      : invitation.expiresAt <= nowOf(deps)
        ? "expired"
        : "pending";
  return { ...row, state };
}

/** What the invitation page shows before signing in. */
export async function previewStaffInvitation(
  deps: ServiceDeps,
  token: string,
): Promise<StaffInvitationPreview> {
  const { invitation, eventName, organizationId, state } = await findInvitation(deps, token);
  return {
    eventName,
    organizerName: await organizerName(deps.db, organizationId),
    email: invitation.email,
    state,
  };
}

/** Accepts with the signed-in account, which must be the invited (and verified) email. */
export async function acceptStaffInvitation(
  deps: ServiceDeps,
  user: { id: string; email: string; emailVerified: boolean },
  token: string,
): Promise<{ eventId: string }> {
  const { invitation, state } = await findInvitation(deps, token);
  if (state !== "pending") throw new ApiError(409, "invalid_state", state);
  if (user.email.toLowerCase() !== invitation.email || !user.emailVerified) {
    throw new ApiError(403, "forbidden", "This invitation is for another email");
  }
  await deps.db.transaction(async (tx) => {
    await tx
      .insert(eventStaff)
      .values({
        eventId: invitation.eventId,
        userId: user.id,
        organizationId: invitation.organizationId,
        addedBy: invitation.invitedBy,
      })
      .onConflictDoNothing();
    await tx
      .update(staffInvitations)
      .set({ acceptedAt: nowOf(deps) })
      .where(eq(staffInvitations.id, invitation.id));
  });
  return { eventId: invitation.eventId };
}

/** Events the user works on as staff (the scanner arrives in Phase 4a). */
export async function assignedEvents(deps: ServiceDeps, userId: string): Promise<AssignedEvent[]> {
  const rows = await deps.db
    .select({ event: events, organizerName: organizations.name })
    .from(eventStaff)
    .innerJoin(events, eq(events.id, eventStaff.eventId))
    .innerJoin(organizations, eq(organizations.id, events.organizationId))
    .where(eq(eventStaff.userId, userId))
    .orderBy(asc(events.startsAt));
  return rows.map(({ event, organizerName: organizer }) => ({
    id: event.id,
    name: event.name,
    startsAt: event.startsAt.toISOString(),
    timezone: event.timezone,
    venueName: event.venueName,
    status: event.status,
    organizerName: organizer,
  }));
}
