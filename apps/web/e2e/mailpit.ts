// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect } from "@playwright/test";

const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://localhost:8025";

interface MailpitMessage {
  ID: string;
  Subject: string;
}

/**
 * Waits for the latest email sent to `to` (optionally with a matching subject; emails are
 * delivered asynchronously by the outbox worker) and returns the first link in its text body.
 */
export async function latestLinkFor(
  to: string,
  options: { subject?: RegExp } = {},
): Promise<{ subject: string; link: string }> {
  let found: MailpitMessage | undefined;
  await expect
    .poll(
      async () => {
        const query = encodeURIComponent(`to:"${to}"`);
        const response = await fetch(`${MAILPIT_URL}/api/v1/search?query=${query}`);
        const { messages } = (await response.json()) as { messages: MailpitMessage[] };
        found = messages.find((m) => !options.subject || options.subject.test(m.Subject));
        return found;
      },
      { timeout: 20_000, message: `email to ${to}` },
    )
    .toBeTruthy();

  const message = (await (await fetch(`${MAILPIT_URL}/api/v1/message/${found!.ID}`)).json()) as {
    Text: string;
  };
  const link = /https?:\/\/\S+/.exec(message.Text)?.[0];
  expect(link, "link in email body").toBeTruthy();
  return { subject: found!.Subject, link: link! };
}
