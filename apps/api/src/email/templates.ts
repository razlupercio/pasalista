// SPDX-License-Identifier: AGPL-3.0-or-later
import { defaultLocale, isLocale, TICKET_TOKEN_PREFIX } from "@pasalista/core";
import { format, messages } from "@pasalista/i18n";
import QRCode from "qrcode";
import { z } from "zod";

const httpUrl = z.url({ protocol: /^https?$/ });

/** Payload schema per email kind. Validated when enqueuing and again when rendering. */
export const emailPayloadSchemas = {
  verify_email: z.object({ name: z.string(), url: httpUrl }),
  reset_password: z.object({ name: z.string(), url: httpUrl }),
  magic_link: z.object({ url: httpUrl }),
  ticket: z.object({
    name: z.string(),
    eventName: z.string(),
    when: z.string(),
    where: z.string(),
    url: httpUrl,
    qrToken: z.string().startsWith(TICKET_TOKEN_PREFIX),
  }),
} as const;

export type EmailKind = keyof typeof emailPayloadSchemas;
export type EmailPayload<K extends EmailKind> = z.infer<(typeof emailPayloadSchemas)[K]>;

export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
  /** Content-ID referenced from the HTML as `cid:<cid>`. */
  cid: string;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
  attachments: EmailAttachment[];
}

const messageKeys = {
  verify_email: "verifyEmail",
  reset_password: "resetPassword",
  magic_link: "magicLink",
  ticket: "ticket",
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

/** QR code PNG for a ticket token (error correction M, see ADR-0002). */
export function ticketQrPng(token: string, width = 512): Promise<Buffer> {
  return QRCode.toBuffer(token, { type: "png", errorCorrectionLevel: "M", margin: 2, width });
}

const QR_CID = "ticket-qr";

export async function renderEmail(
  kind: EmailKind,
  locale: string,
  rawPayload: unknown,
): Promise<RenderedEmail> {
  const catalog = messages[isLocale(locale) ? locale : defaultLocale].emails;
  const strings = catalog[messageKeys[kind]];
  const payload = emailPayloadSchemas[kind].parse(rawPayload);
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(payload)) values[key] = String(value);

  const greeting = format(strings.greeting, values);
  const body = format(strings.body, values);
  const textLines = [greeting, "", body];
  const htmlParts = [`<p>${escapeHtml(greeting)}</p>`, `<p>${escapeHtml(body)}</p>`];
  const attachments: EmailAttachment[] = [];

  if (kind === "ticket") {
    const ticket = emailPayloadSchemas.ticket.parse(payload);
    const t = catalog.ticket;
    textLines.push(
      "",
      `${t.whenLabel}: ${ticket.when}`,
      `${t.whereLabel}: ${ticket.where}`,
      "",
      t.qrHint,
    );
    htmlParts.push(
      `<p><strong>${escapeHtml(t.whenLabel)}:</strong> ${escapeHtml(ticket.when)}<br><strong>${escapeHtml(t.whereLabel)}:</strong> ${escapeHtml(ticket.where)}</p>`,
      `<p><img src="cid:${QR_CID}" width="256" height="256" alt="${escapeHtml(t.qrAlt)}"></p>`,
      `<p>${escapeHtml(t.qrHint)}</p>`,
    );
    attachments.push({
      filename: "ticket-qr.png",
      content: await ticketQrPng(ticket.qrToken),
      contentType: "image/png",
      cid: QR_CID,
    });
  }

  textLines.push("", `${strings.cta}: ${payload.url}`, "", catalog.footer);
  htmlParts.push(
    `<p><a href="${escapeHtml(payload.url)}" style="display: inline-block; padding: 12px 20px; background: #111; color: #fff; text-decoration: none; border-radius: 6px;">${escapeHtml(strings.cta)}</a></p>`,
    `<p style="font-size: 12px; color: #555;">${escapeHtml(catalog.footer)}</p>`,
  );

  const html = `<!doctype html>
<html lang="${escapeHtml(locale)}">
  <body style="font-family: system-ui, sans-serif; line-height: 1.5; color: #111;">
    ${htmlParts.join("\n    ")}
  </body>
</html>`;

  return {
    subject: format(strings.subject, values),
    text: textLines.join("\n"),
    html,
    attachments,
  };
}
