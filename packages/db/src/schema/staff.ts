// SPDX-License-Identifier: AGPL-3.0-or-later
import { index, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organizations, users } from "./auth.ts";
import { bytea, createdAt, id } from "./columns.ts";
import { events } from "./events.ts";

/** Staff (scanners) assigned to an event. They are not organization members (ADR-0003). */
export const eventStaff = pgTable(
  "event_staff",
  {
    eventId: uuid()
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    addedBy: uuid().references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.userId] }), index().on(t.userId)],
);

/** Email invitations to become staff. Only the token hash is stored; it is single use. */
export const staffInvitations = pgTable(
  "staff_invitations",
  {
    id: id(),
    eventId: uuid()
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: text().notNull(),
    tokenHash: bytea().notNull().unique(),
    invitedBy: uuid().references(() => users.id, { onDelete: "set null" }),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    acceptedAt: timestamp({ withTimezone: true }),
    revokedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.eventId)],
);
