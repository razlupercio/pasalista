// SPDX-License-Identifier: AGPL-3.0-or-later
import { defaultLocale, isLocale } from "@pasalista/core";
import { format, messages } from "@pasalista/i18n";
import { z } from "zod";

const httpUrl = z.url({ protocol: /^https?$/ });

/** Payload schema per email kind. Validated when enqueuing and again when rendering. */
export const emailPayloadSchemas = {
  verify_email: z.object({ name: z.string(), url: httpUrl }),
  reset_password: z.object({ name: z.string(), url: httpUrl }),
  magic_link: z.object({ url: httpUrl }),
} as const;

export type EmailKind = keyof typeof emailPayloadSchemas;
export type EmailPayload<K extends EmailKind> = z.infer<(typeof emailPayloadSchemas)[K]>;

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

const messageKeys = {
  verify_email: "verifyEmail",
  reset_password: "resetPassword",
  magic_link: "magicLink",
} as const satisfies Record<EmailKind, string>;

export function isEmailKind(kind: string): kind is EmailKind {
  return kind in emailPayloadSchemas;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderEmail(kind: EmailKind, locale: string, rawPayload: unknown): RenderedEmail {
  const catalog = messages[isLocale(locale) ? locale : defaultLocale].emails;
  const strings = catalog[messageKeys[kind]];
  const payload = emailPayloadSchemas[kind].parse(rawPayload);
  const values = { name: (payload as { name?: string }).name ?? "" };

  const greeting = format(strings.greeting, values);
  const text = [
    greeting,
    "",
    strings.body,
    "",
    `${strings.cta}: ${payload.url}`,
    "",
    catalog.footer,
  ].join("\n");
  const html = `<!doctype html>
<html lang="${escapeHtml(locale)}">
  <body style="font-family: system-ui, sans-serif; line-height: 1.5; color: #111;">
    <p>${escapeHtml(greeting)}</p>
    <p>${escapeHtml(strings.body)}</p>
    <p><a href="${escapeHtml(payload.url)}" style="display: inline-block; padding: 12px 20px; background: #111; color: #fff; text-decoration: none; border-radius: 6px;">${escapeHtml(strings.cta)}</a></p>
    <p style="font-size: 12px; color: #555;">${escapeHtml(catalog.footer)}</p>
  </body>
</html>`;

  return { subject: strings.subject, text, html };
}
