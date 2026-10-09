// SPDX-License-Identifier: AGPL-3.0-or-later
import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./auth.ts";
import { createdAt, id } from "./columns.ts";
import { events } from "./events.ts";

export const emailStatus = pgEnum("email_status", ["pending", "sent", "failed"]);

/**
 * Transactional outbox: rows are written together with the business change and delivered
 * by a worker. `payload` holds template data (it may contain one-time links) and is cleared
 * once the email is sent or permanently fails.
 */
export const emailOutbox = pgTable(
  "email_outbox",
  {
    id: id(),
    organizationId: uuid().references(() => organizations.id, { onDelete: "cascade" }),
    /** Set for event emails (tickets, staff invitations) so a data purge can remove them. */
    eventId: uuid().references(() => events.id, { onDelete: "cascade" }),
    kind: text().notNull(),
    toEmail: text().notNull(),
    locale: text().notNull(),
    payload: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    status: emailStatus().notNull().default("pending"),
    attempts: integer().notNull().default(0),
    nextAttemptAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp({ withTimezone: true }),
    lastError: text(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.status, t.nextAttemptAt), index().on(t.eventId)],
);
