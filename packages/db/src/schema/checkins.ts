// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { organizations, users } from "./auth.ts";
import { createdAt, id } from "./columns.ts";
import { attendees, events, tickets } from "./events.ts";

export const checkInMethod = pgEnum("check_in_method", ["qr", "manual"]);
export const checkInMode = pgEnum("check_in_mode", ["online", "offline"]);
export const checkInOutcome = pgEnum("check_in_outcome", [
  "valid",
  "already_used",
  "invalid",
  "wrong_event",
  "revoked",
  "outside_window",
  "duplicate_offline",
]);

/**
 * One row per attendee who entered. `UNIQUE (event_id, attendee_id)` makes check-in idempotent:
 * concurrent scans of the same ticket insert at most one row (ADR-0009).
 */
export const checkIns = pgTable(
  "check_ins",
  {
    id: id(),
    eventId: uuid()
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    attendeeId: uuid()
      .notNull()
      .references(() => attendees.id, { onDelete: "cascade" }),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    ticketId: uuid().references(() => tickets.id, { onDelete: "set null" }),
    scannedBy: uuid().references(() => users.id, { onDelete: "set null" }),
    clientCheckInId: uuid().notNull(),
    deviceId: text(),
    method: checkInMethod().notNull(),
    mode: checkInMode().notNull().default("online"),
    /** Device clock (offline scans are synced later). */
    scannedAt: timestamp({ withTimezone: true }).notNull(),
    receivedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /** The device clock looked wrong and `scanned_at` was clamped (offline sync, ADR-0005). */
    clockAdjusted: boolean().notNull().default(false),
  },
  (t) => [
    uniqueIndex().on(t.eventId, t.attendeeId),
    uniqueIndex().on(t.clientCheckInId),
    index().on(t.eventId, t.scannedAt),
  ],
);

/** Every scan, whatever the outcome: who validated what and when (audit trail, dashboard). */
export const checkInAttempts = pgTable(
  "check_in_attempts",
  {
    id: id(),
    eventId: uuid()
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    attendeeId: uuid().references(() => attendees.id, { onDelete: "cascade" }),
    scannedBy: uuid().references(() => users.id, { onDelete: "set null" }),
    clientCheckInId: uuid(),
    deviceId: text(),
    method: checkInMethod().notNull(),
    outcome: checkInOutcome().notNull(),
    scannedAt: timestamp({ withTimezone: true }).notNull(),
    receivedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.eventId, t.receivedAt)],
);

/** Organizer actions worth tracing. `metadata` must never contain personal data or secrets. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    actorUserId: uuid().references(() => users.id, { onDelete: "set null" }),
    eventId: uuid().references(() => events.id, { onDelete: "set null" }),
    action: text().notNull(),
    entityType: text().notNull(),
    entityId: uuid(),
    metadata: jsonb()
      .$type<Record<string, string | number | boolean | null>>()
      .notNull()
      .default({}),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.organizationId, t.createdAt), index().on(t.eventId, t.createdAt)],
);
