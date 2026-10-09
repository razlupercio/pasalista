// SPDX-License-Identifier: AGPL-3.0-or-later
// Offline scanning (ADR-0005): the bundle a scanner downloads before the event, the local
// verification it runs without network, and the sync protocol. Platform-agnostic so the
// future mobile app reuses it.
import { z } from "zod";
import type { CheckInOutcome } from "./checkin.ts";
import { fromBase64Url } from "./encoding.ts";
import { bytesEqual, verifyTicketToken } from "./qr-token.ts";

/**
 * What the scanner device stores about a person: first name and last initial only
 * (maintainer decision). `Ana María López` → `Ana L.`
 */
export function displayName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? "";
  const last = parts[parts.length - 1] as string;
  return `${parts[0]} ${last.charAt(0).toUpperCase()}.`;
}

const instant = z.iso.datetime({ offset: true });

export const offlineBundleSchema = z.object({
  event: z.object({
    id: z.uuid(),
    name: z.string(),
    timezone: z.string(),
    opensAt: instant,
    closesAt: instant,
  }),
  /** Public keys that still verify (active and retired), base64url. Revoked keys are left out. */
  keys: z.array(z.object({ version: z.number().int(), publicKey: z.string() })),
  attendees: z.array(
    z.object({
      id: z.uuid(),
      displayName: z.string(),
      /** Nonce of the active ticket (base64url); null when there is none (pending or revoked). */
      nonce: z.string().nullable(),
      /** Guests whose invitation was not sent yet may still be checked in manually. */
      manualAllowed: z.boolean(),
      checkedInAt: instant.nullable(),
    }),
  ),
  generatedAt: instant,
});
export type OfflineBundle = z.infer<typeof offlineBundleSchema>;
export type OfflineAttendee = OfflineBundle["attendees"][number];

export interface OfflineScan {
  outcome: CheckInOutcome;
  attendee: OfflineAttendee | null;
}

/**
 * Verifies a QR token against the bundle (ADR-0002 steps 1–4) and the device's own check-ins.
 * `checkedIn` holds attendee ids already checked in (from the bundle or this device).
 */
export function evaluateOfflineScan(
  bundle: OfflineBundle,
  token: string,
  checkedIn: ReadonlySet<string>,
  now: Date,
): OfflineScan {
  if (now < new Date(bundle.event.opensAt) || now > new Date(bundle.event.closesAt)) {
    return { outcome: "outside_window", attendee: null };
  }
  const publicKeys = new Map<number, Uint8Array>();
  for (const key of bundle.keys) {
    const bytes = fromBase64Url(key.publicKey);
    if (bytes) publicKeys.set(key.version, bytes);
  }
  const check = verifyTicketToken(token, { eventId: bundle.event.id, publicKeys });
  if (!check.ok) {
    return { outcome: check.reason === "wrong_event" ? "wrong_event" : "invalid", attendee: null };
  }
  const attendee = bundle.attendees.find((a) => a.id === check.payload.attendeeId) ?? null;
  const nonce = attendee?.nonce ? fromBase64Url(attendee.nonce) : null;
  if (!attendee || !nonce || !bytesEqual(nonce, check.payload.nonce)) {
    return { outcome: "revoked", attendee: null };
  }
  if (attendee.checkedInAt || checkedIn.has(attendee.id))
    return { outcome: "already_used", attendee };
  return { outcome: "valid", attendee };
}

/** Manual check-in while offline (attendee picked from a name search on the bundle). */
export function evaluateOfflineManual(
  bundle: OfflineBundle,
  attendeeId: string,
  checkedIn: ReadonlySet<string>,
  now: Date,
): OfflineScan {
  if (now < new Date(bundle.event.opensAt) || now > new Date(bundle.event.closesAt)) {
    return { outcome: "outside_window", attendee: null };
  }
  const attendee = bundle.attendees.find((a) => a.id === attendeeId) ?? null;
  if (!attendee) return { outcome: "invalid", attendee: null };
  if (!attendee.nonce && !attendee.manualAllowed) return { outcome: "revoked", attendee: null };
  if (attendee.checkedInAt || checkedIn.has(attendee.id))
    return { outcome: "already_used", attendee };
  return { outcome: "valid", attendee };
}

export const MAX_SYNC_ITEMS = 500;

export const syncItemSchema = z.discriminatedUnion("method", [
  z.object({
    method: z.literal("qr"),
    clientCheckInId: z.uuid(),
    token: z.string().min(1).max(512),
    scannedAt: instant,
  }),
  z.object({
    method: z.literal("manual"),
    clientCheckInId: z.uuid(),
    attendeeId: z.uuid(),
    scannedAt: instant,
  }),
]);
export type SyncItem = z.infer<typeof syncItemSchema>;

export const syncRequestSchema = z.object({
  deviceId: z.string().max(64),
  items: z.array(syncItemSchema).min(1).max(MAX_SYNC_ITEMS),
});
export type SyncRequest = z.infer<typeof syncRequestSchema>;

/**
 * Per item: `accepted` (this scan is the check-in), `duplicate` (someone was checked in earlier;
 * reported on the dashboard), `rejected` (the server no longer considers the ticket valid).
 */
export const syncStatuses = ["accepted", "duplicate", "rejected"] as const;

export const syncResultSchema = z.object({
  results: z.array(
    z.object({
      clientCheckInId: z.uuid(),
      status: z.enum(syncStatuses),
      /** Server-side reason for `rejected`. */
      outcome: z.string().nullable(),
      /** When the attendee's (kept) check-in happened. */
      checkedInAt: instant.nullable(),
    }),
  ),
  counts: z.object({ checkedIn: z.number().int(), registered: z.number().int() }),
});
export type SyncResult = z.infer<typeof syncResultSchema>;
