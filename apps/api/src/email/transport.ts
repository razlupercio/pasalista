// SPDX-License-Identifier: AGPL-3.0-or-later
import nodemailer from "nodemailer";
import type { Env } from "../env.ts";

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailTransport {
  send(email: OutgoingEmail): Promise<void>;
}

export function createSmtpTransport(env: Env): EmailTransport {
  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD ?? "" } } : {}),
  });
  return {
    async send(email) {
      await transporter.sendMail({ from: env.EMAIL_FROM, ...email });
    },
  };
}
