// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Database } from "@pasalista/db";
import { schema } from "@pasalista/db";
import { and, asc, eq, inArray, lte } from "drizzle-orm";
import type { Logger } from "pino";
import {
  emailPayloadSchemas,
  isEmailKind,
  renderEmail,
  type EmailKind,
  type EmailPayload,
} from "./templates.ts";
import type { EmailTransport } from "./transport.ts";

const { emailOutbox } = schema;

export const MAX_EMAIL_ATTEMPTS = 6;

/** Exponential backoff: 30 s, 1 min, 2 min, 4 min, 8 min. */
export function retryDelayMs(attempts: number): number {
  return 30_000 * 2 ** Math.max(0, attempts - 1);
}

export async function enqueueEmail<K extends EmailKind>(
  db: Pick<Database, "insert">,
  email: {
    kind: K;
    to: string;
    locale: string;
    payload: EmailPayload<K>;
    organizationId?: string;
    /** Event emails carry it so a data purge can remove them (ADR-0011). */
    eventId?: string;
  },
): Promise<void> {
  const payload = emailPayloadSchemas[email.kind].parse(email.payload);
  await db.insert(emailOutbox).values({
    kind: email.kind,
    toEmail: email.to,
    locale: email.locale,
    payload,
    organizationId: email.organizationId ?? null,
    eventId: email.eventId ?? null,
  });
}

/**
 * Sends up to `batchSize` due emails. Rows are locked with `FOR UPDATE SKIP LOCKED`, so several
 * workers can run concurrently without sending the same email twice.
 */
export async function processOutboxBatch(
  db: Database,
  transport: EmailTransport,
  logger: Logger,
  /** `onlyIds` restricts the batch to specific rows (targeted retries, tests). */
  options: { batchSize?: number; now?: Date; onlyIds?: string[] } = {},
): Promise<{ sent: number; failed: number }> {
  const now = options.now ?? new Date();
  return db.transaction(async (tx) => {
    const due = await tx
      .select()
      .from(emailOutbox)
      .where(
        and(
          eq(emailOutbox.status, "pending"),
          lte(emailOutbox.nextAttemptAt, now),
          options.onlyIds ? inArray(emailOutbox.id, options.onlyIds) : undefined,
        ),
      )
      .orderBy(asc(emailOutbox.nextAttemptAt))
      .limit(options.batchSize ?? 10)
      .for("update", { skipLocked: true });

    let sent = 0;
    let failed = 0;
    for (const row of due) {
      try {
        if (!isEmailKind(row.kind)) throw new Error(`Unknown email kind: ${row.kind}`);
        const rendered = await renderEmail(row.kind, row.locale, row.payload);
        await transport.send({ to: row.toEmail, ...rendered });
        await tx
          .update(emailOutbox)
          .set({
            status: "sent",
            sentAt: now,
            payload: {},
            attempts: row.attempts + 1,
            lastError: null,
          })
          .where(eq(emailOutbox.id, row.id));
        sent += 1;
      } catch (error) {
        const attempts = row.attempts + 1;
        const exhausted = attempts >= MAX_EMAIL_ATTEMPTS;
        const message = error instanceof Error ? error.message : String(error);
        await tx
          .update(emailOutbox)
          .set({
            attempts,
            status: exhausted ? "failed" : "pending",
            nextAttemptAt: new Date(now.getTime() + retryDelayMs(attempts)),
            lastError: message.slice(0, 500),
            ...(exhausted ? { payload: {} } : {}),
          })
          .where(eq(emailOutbox.id, row.id));
        failed += 1;
        // Id and kind only: recipient and payload are personal data / secrets.
        logger.warn(
          { emailId: row.id, kind: row.kind, attempts, exhausted },
          "email delivery failed",
        );
      }
    }
    return { sent, failed };
  });
}

export function startOutboxWorker(
  db: Database,
  transport: EmailTransport,
  logger: Logger,
  options: { intervalMs?: number; batchSize?: number } = {},
): { stop: () => Promise<void> } {
  const intervalMs = options.intervalMs ?? 2_000;
  const batchSize = options.batchSize ?? 25;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<unknown> = Promise.resolve();

  const tick = () => {
    let busy = false;
    running = processOutboxBatch(db, transport, logger, { batchSize })
      .then(({ sent, failed }) => {
        // A full batch means more is probably waiting (e.g. bulk invitations): continue now.
        busy = sent + failed >= batchSize;
      })
      .catch((error: unknown) => logger.error({ err: error }, "email outbox worker error"))
      .finally(() => {
        if (!stopped) timer = setTimeout(tick, busy ? 0 : intervalMs);
      });
  };
  tick();

  return {
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await running;
    },
  };
}
