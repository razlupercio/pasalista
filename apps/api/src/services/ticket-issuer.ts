// SPDX-License-Identifier: AGPL-3.0-or-later
import { generateTicketNonce, signTicketToken, type TicketTokenPayload } from "@pasalista/core";
import { schema } from "@pasalista/db";
import { and, eq, inArray } from "drizzle-orm";
import { newAccessToken } from "../crypto/key-encryption.ts";
import { emailPayloadSchemas, type EmailPayload } from "../email/templates.ts";
import { nowOf, type Executor, type ServiceDeps, type Transaction } from "./context.ts";
import { activeKeyVersion, loadSecretKey } from "./signing-keys.ts";

const { attendees, emailOutbox, tickets } = schema;

type EventRow = typeof schema.events.$inferSelect;
type AttendeeRow = typeof attendees.$inferSelect;
export type TicketEmailVariant = EmailPayload<"ticket">["variant"];

/** Signs tickets with one decrypted key; call `dispose` to zero it. */
export interface TicketSigner {
  keyVersion: number;
  sign(ticket: Omit<TicketTokenPayload, "keyVersion">): string;
  dispose(): void;
}

export async function createSigner(
  deps: ServiceDeps,
  db: Executor,
  eventId: string,
  keyVersion?: number,
): Promise<TicketSigner> {
  const version = keyVersion ?? (await activeKeyVersion(db, eventId));
  const secretKey = await loadSecretKey(db, deps.kek, eventId, version);
  return {
    keyVersion: version,
    sign: (ticket) => signTicketToken({ ...ticket, keyVersion: version }, secretKey),
    dispose: () => secretKey.fill(0),
  };
}

/** Signs one existing ticket (used by the ticket page and resends). */
export async function signExistingTicket(
  deps: ServiceDeps,
  db: Executor,
  ticket: { eventId: string; attendeeId: string; keyVersion: number; nonce: Uint8Array },
): Promise<string> {
  const signer = await createSigner(deps, db, ticket.eventId, ticket.keyVersion);
  try {
    return signer.sign(ticket);
  } finally {
    signer.dispose();
  }
}

function ticketEmailRow(
  deps: ServiceDeps,
  event: EventRow,
  attendee: AttendeeRow,
  accessToken: string,
  qrToken: string,
  variant: TicketEmailVariant,
): typeof emailOutbox.$inferInsert {
  const when = new Intl.DateTimeFormat(attendee.locale, {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: event.timezone,
  }).format(event.startsAt);
  const payload = emailPayloadSchemas.ticket.parse({
    variant,
    name: attendee.name,
    eventName: event.name,
    when,
    where: [event.venueName, event.venueAddress].filter(Boolean).join(", "),
    url: `${deps.publicUrl}/${attendee.locale}/t/${accessToken}`,
    qrToken,
  });
  return {
    kind: "ticket",
    toEmail: attendee.email,
    locale: attendee.locale,
    organizationId: event.organizationId,
    payload,
  };
}

/**
 * Issues new tickets (fresh nonce, current key version) and new "my ticket" links for the given
 * attendees, superseding any active ticket, and queues the ticket emails in the same transaction.
 */
export async function issueTickets(
  deps: ServiceDeps,
  tx: Transaction,
  event: EventRow,
  list: AttendeeRow[],
  variant: TicketEmailVariant,
): Promise<number> {
  if (list.length === 0) return 0;
  const ids = list.map((a) => a.id);
  await tx
    .update(tickets)
    .set({ status: "superseded", revokedAt: nowOf(deps), revokedReason: "reissued" })
    .where(and(inArray(tickets.attendeeId, ids), eq(tickets.status, "active")));

  const signer = await createSigner(deps, tx, event.id);
  try {
    const newTickets: (typeof tickets.$inferInsert)[] = [];
    const emails: (typeof emailOutbox.$inferInsert)[] = [];
    for (const attendee of list) {
      const nonce = generateTicketNonce();
      newTickets.push({
        attendeeId: attendee.id,
        eventId: event.id,
        keyVersion: signer.keyVersion,
        nonce,
      });
      const access = newAccessToken();
      await tx
        .update(attendees)
        .set({ ticketAccessHash: access.hash, invitationPending: false })
        .where(eq(attendees.id, attendee.id));
      const qrToken = signer.sign({ eventId: event.id, attendeeId: attendee.id, nonce });
      emails.push(ticketEmailRow(deps, event, attendee, access.token, qrToken, variant));
    }
    for (let i = 0; i < newTickets.length; i += 500) {
      await tx.insert(tickets).values(newTickets.slice(i, i + 500));
      await tx.insert(emailOutbox).values(emails.slice(i, i + 500));
    }
    return list.length;
  } finally {
    signer.dispose();
  }
}

/** Emails the current ticket again with a new link; the QR code does not change. */
export async function resendTicketEmail(
  deps: ServiceDeps,
  tx: Transaction,
  event: EventRow,
  attendee: AttendeeRow,
  ticket: typeof tickets.$inferSelect,
): Promise<void> {
  const qrToken = await signExistingTicket(deps, tx, ticket);
  const access = newAccessToken();
  await tx
    .update(attendees)
    .set({ ticketAccessHash: access.hash })
    .where(eq(attendees.id, attendee.id));
  const variant = attendee.source === "open_registration" ? "registration" : "invitation";
  await tx
    .insert(emailOutbox)
    .values(ticketEmailRow(deps, event, attendee, access.token, qrToken, variant));
}
