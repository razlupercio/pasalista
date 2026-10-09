// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Answers, RegistrationField } from "@pasalista/core";
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { organizations, users } from "./auth.ts";
import { bytea, createdAt, id, updatedAt } from "./columns.ts";

export const eventStatus = pgEnum("event_status", ["draft", "published", "closed"]);
export const registrationMode = pgEnum("registration_mode", ["open", "closed"]);
export const signingKeyStatus = pgEnum("signing_key_status", ["active", "retired", "revoked"]);
export const attendeeStatus = pgEnum("attendee_status", ["active", "cancelled"]);
export const attendeeSource = pgEnum("attendee_source", ["open_registration", "import", "manual"]);
export const ticketStatus = pgEnum("ticket_status", ["active", "superseded", "revoked"]);

export const events = pgTable(
  "events",
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    slug: text().notNull().unique(),
    name: text().notNull(),
    description: text(),
    startsAt: timestamp({ withTimezone: true }).notNull(),
    endsAt: timestamp({ withTimezone: true }),
    timezone: text().notNull(),
    venueName: text().notNull(),
    venueAddress: text(),
    capacity: integer(),
    registrationMode: registrationMode().notNull().default("open"),
    registrationDeadline: timestamp({ withTimezone: true }),
    registrationFields: jsonb().$type<RegistrationField[]>().notNull().default([]),
    status: eventStatus().notNull().default("draft"),
    createdBy: uuid().references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.organizationId, t.startsAt)],
);

/** Per-event Ed25519 keys (ADR-0002). The private key is AES-256-GCM encrypted at rest. */
export const eventSigningKeys = pgTable(
  "event_signing_keys",
  {
    id: id(),
    eventId: uuid()
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    version: integer().notNull(),
    publicKey: bytea().notNull(),
    privateKeyCiphertext: bytea().notNull(),
    kekId: text().notNull(),
    status: signingKeyStatus().notNull().default("active"),
    createdAt: createdAt(),
    revokedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    uniqueIndex().on(t.eventId, t.version),
    uniqueIndex("event_signing_keys_one_active")
      .on(t.eventId)
      .where(sql`${t.status} = 'active'`),
  ],
);

export const attendees = pgTable(
  "attendees",
  {
    id: id(),
    eventId: uuid()
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text().notNull(),
    email: text().notNull(),
    locale: text().notNull(),
    source: attendeeSource().notNull(),
    status: attendeeStatus().notNull().default("active"),
    answers: jsonb().$type<Answers>().notNull().default({}),
    /** SHA-256 of the secret "my ticket" link token; the token itself is never stored. */
    ticketAccessHash: bytea().notNull().unique(),
    /** Added by the organizer and not emailed yet ("Send invitations" picks these up). */
    invitationPending: boolean().notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    cancelledAt: timestamp({ withTimezone: true }),
  },
  (t) => [uniqueIndex().on(t.eventId, t.email), index().on(t.organizationId)],
);

export const tickets = pgTable(
  "tickets",
  {
    id: id(),
    attendeeId: uuid()
      .notNull()
      .references(() => attendees.id, { onDelete: "cascade" }),
    eventId: uuid()
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    keyVersion: integer().notNull(),
    nonce: bytea().notNull(),
    status: ticketStatus().notNull().default("active"),
    issuedAt: createdAt(),
    revokedAt: timestamp({ withTimezone: true }),
    revokedReason: text(),
  },
  (t) => [
    uniqueIndex("tickets_one_active_per_attendee")
      .on(t.attendeeId)
      .where(sql`${t.status} = 'active'`),
    index().on(t.eventId),
  ],
);
