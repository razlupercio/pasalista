// SPDX-License-Identifier: AGPL-3.0-or-later
// Guest lists (closed registration), attendee listing and staff invitations.
import { z } from "zod";
import { emailSchema, personNameSchema } from "./auth.ts";
import type { RawGuest } from "./csv.ts";
import { attendeeSchema, attendeeStatuses, eventStatuses, ticketStatuses } from "./events.ts";
import { isLocale, localeSchema, type Locale } from "./locale.ts";

export const MAX_IMPORT_ROWS = 2_000;

export const guestInputSchema = z.object({
  name: personNameSchema,
  email: emailSchema,
  locale: localeSchema,
});
export type GuestInput = z.infer<typeof guestInputSchema>;

/** Raw rows as read from the file; each one is validated individually so one bad row does not block the rest. */
export const importRowSchema = z.object({
  line: z.number().int().min(1),
  name: z.string().max(1_000),
  email: z.string().max(1_000),
  locale: z.string().max(20).nullable(),
});

export const importRequestSchema = z.object({
  rows: z.array(importRowSchema).min(1).max(MAX_IMPORT_ROWS),
  defaultLocale: localeSchema,
});
export type ImportRequest = z.infer<typeof importRequestSchema>;

export const importProblems = [
  "invalid_name",
  "invalid_email",
  "invalid_locale",
  "duplicate_in_file",
  "already_on_list",
] as const;
export type ImportProblem = (typeof importProblems)[number];

export const importReportSchema = z.object({
  added: z.number().int(),
  skipped: z.array(
    z.object({ line: z.number().int(), email: z.string(), problem: z.enum(importProblems) }),
  ),
});
export type ImportReport = z.infer<typeof importReportSchema>;

export type PlannedGuest = GuestInput & { line: number };

/**
 * Validates and de-duplicates guest rows (first occurrence of an email wins). Shared by the web
 * preview and the API, which re-validates everything.
 */
export function planGuestImport(
  rows: readonly Pick<RawGuest, "line" | "name" | "email" | "locale">[],
  defaultLocale: Locale,
): { guests: PlannedGuest[]; skipped: ImportReport["skipped"] } {
  const guests: PlannedGuest[] = [];
  const skipped: ImportReport["skipped"] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const skip = (problem: ImportProblem) =>
      skipped.push({ line: row.line, email: row.email.slice(0, 254), problem });
    const email = emailSchema.safeParse(row.email);
    if (!email.success) {
      skip("invalid_email");
      continue;
    }
    const name = personNameSchema.safeParse(row.name);
    if (!name.success) {
      skip("invalid_name");
      continue;
    }
    const locale = row.locale ? row.locale : defaultLocale;
    if (!isLocale(locale)) {
      skip("invalid_locale");
      continue;
    }
    if (seen.has(email.data)) {
      skip("duplicate_in_file");
      continue;
    }
    seen.add(email.data);
    guests.push({ line: row.line, name: name.data, email: email.data, locale });
  }
  return { guests, skipped };
}

/** Ticket state filter: `pending` means the invitation has not been sent yet. */
export const ticketFilters = ["pending", ...ticketStatuses] as const;

export const attendeeListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(attendeeStatuses).optional(),
  ticket: z.enum(ticketFilters).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
export type AttendeeListQuery = z.infer<typeof attendeeListQuerySchema>;

export const attendeeListSchema = z.object({
  items: z.array(attendeeSchema),
  total: z.number().int(),
  /** Active attendees whose invitation has not been sent. */
  pendingCount: z.number().int(),
});
export type AttendeeList = z.infer<typeof attendeeListSchema>;

export const sendInvitationsResultSchema = z.object({ sent: z.number().int() });

// --- Staff -------------------------------------------------------------------------------

export const staffInviteInputSchema = z.object({ email: emailSchema, locale: localeSchema });

export const staffOverviewSchema = z.object({
  members: z.array(
    z.object({
      userId: z.uuid(),
      name: z.string(),
      email: z.string(),
      addedAt: z.iso.datetime({ offset: true }),
    }),
  ),
  invitations: z.array(
    z.object({ id: z.uuid(), email: z.string(), expiresAt: z.iso.datetime({ offset: true }) }),
  ),
});
export type StaffOverview = z.infer<typeof staffOverviewSchema>;

export const staffInvitationStates = ["pending", "accepted", "expired", "revoked"] as const;

export const staffInvitationPreviewSchema = z.object({
  eventName: z.string(),
  organizerName: z.string(),
  email: z.string(),
  state: z.enum(staffInvitationStates),
});
export type StaffInvitationPreview = z.infer<typeof staffInvitationPreviewSchema>;

export const assignedEventSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  startsAt: z.iso.datetime({ offset: true }),
  timezone: z.string(),
  venueName: z.string(),
  status: z.enum(eventStatuses),
  organizerName: z.string(),
});
export type AssignedEvent = z.infer<typeof assignedEventSchema>;
