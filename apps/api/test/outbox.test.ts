// SPDX-License-Identifier: AGPL-3.0-or-later
import { schema } from "@pasalista/db";
import { eq } from "drizzle-orm";
import { pino } from "pino";
import { afterAll, describe, expect, it } from "vitest";
import { enqueueEmail, MAX_EMAIL_ATTEMPTS, processOutboxBatch } from "../src/email/outbox.ts";
import type { EmailTransport, OutgoingEmail } from "../src/email/transport.ts";
import { createTestContext, uniqueEmail } from "./helpers.ts";

const ctx = createTestContext();
afterAll(() => ctx.close());
const logger = pino({ level: "silent" });

function recordingTransport(fail = false): EmailTransport & { sent: OutgoingEmail[] } {
  const sent: OutgoingEmail[] = [];
  return {
    sent,
    send(email) {
      if (fail) return Promise.reject(new Error("SMTP unavailable"));
      sent.push(email);
      return Promise.resolve();
    },
  };
}

async function rowFor(to: string) {
  const [row] = await ctx.db
    .select()
    .from(schema.emailOutbox)
    .where(eq(schema.emailOutbox.toEmail, to));
  return row!;
}

/** A clock far in the future so rows queued by other tests are due too; we only assert on ours. */
const later = (minutes: number) => new Date(Date.now() + minutes * 60_000);

describe("email outbox", () => {
  it("renders, sends and clears the payload of due emails", async () => {
    const to = uniqueEmail();
    await enqueueEmail(ctx.db, {
      kind: "verify_email",
      to,
      locale: "en",
      payload: { name: "Ana <b>", url: "http://localhost:3000/api/v1/auth/verify-email?token=abc" },
    });
    const transport = recordingTransport();
    await processOutboxBatch(ctx.db, transport, logger, { batchSize: 1_000, now: later(1) });

    const mail = transport.sent.find((m) => m.to === to);
    expect(mail?.subject).toBe("Verify your email on PasaLista");
    expect(mail?.html).toContain("Ana &lt;b&gt;");
    expect(mail?.text).toContain("token=abc");

    const row = await rowFor(to);
    expect(row).toMatchObject({ status: "sent", attempts: 1, payload: {} });
    expect(row.sentAt).not.toBeNull();
  });

  it("retries with backoff and gives up after the maximum attempts", async () => {
    const to = uniqueEmail();
    await enqueueEmail(ctx.db, {
      kind: "magic_link",
      to,
      locale: "es-MX",
      payload: { url: "http://localhost:3000/x" },
    });
    const failing = recordingTransport(true);

    await processOutboxBatch(ctx.db, failing, logger, { batchSize: 1_000, now: later(1) });
    let row = await rowFor(to);
    expect(row).toMatchObject({ status: "pending", attempts: 1, lastError: "SMTP unavailable" });
    expect(row.nextAttemptAt.getTime()).toBeGreaterThan(later(1).getTime());

    // Not due yet: nothing happens.
    await processOutboxBatch(ctx.db, failing, logger, { batchSize: 1_000, now: later(1) });
    expect((await rowFor(to)).attempts).toBe(1);

    for (let i = 2; i <= MAX_EMAIL_ATTEMPTS; i++) {
      await processOutboxBatch(ctx.db, failing, logger, { batchSize: 1_000, now: later(60 * i) });
    }
    row = await rowFor(to);
    expect(row).toMatchObject({ status: "failed", attempts: MAX_EMAIL_ATTEMPTS, payload: {} });
  });

  it("rejects invalid payloads when enqueuing", async () => {
    await expect(
      enqueueEmail(ctx.db, {
        kind: "magic_link",
        to: uniqueEmail(),
        locale: "en",
        payload: { url: "not a url" },
      }),
    ).rejects.toThrow();
  });
});
