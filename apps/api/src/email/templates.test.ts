// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  generateSigningKeyPair,
  generateTicketNonce,
  signTicketToken,
  uuidv7,
} from "@pasalista/core";
import { describe, expect, it } from "vitest";
import { escapeHtml, renderEmail } from "./templates.ts";

describe("renderEmail", () => {
  const payload = {
    name: "Ana",
    url: "https://events.example.org/api/v1/auth/verify-email?token=t",
  };

  it("renders in the recipient locale", async () => {
    expect((await renderEmail("verify_email", "es-MX", payload)).subject).toBe(
      "Verifica tu correo en PasaLista",
    );
    expect((await renderEmail("verify_email", "en", payload)).subject).toBe(
      "Verify your email on PasaLista",
    );
  });

  it("falls back to the default locale for unknown locales", async () => {
    expect((await renderEmail("verify_email", "fr", payload)).subject).toBe(
      "Verifica tu correo en PasaLista",
    );
  });

  it("escapes user-controlled values in HTML", async () => {
    const { html } = await renderEmail("verify_email", "en", {
      ...payload,
      name: '<script>alert("x")</script>',
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("includes the link in the plain-text part", async () => {
    expect((await renderEmail("magic_link", "en", { url: payload.url })).text).toContain(
      payload.url,
    );
  });

  it("rejects payloads that do not match the email kind", async () => {
    await expect(renderEmail("magic_link", "en", { url: "javascript:alert(1)" })).rejects.toThrow();
  });
});

describe("ticket email", () => {
  const keys = generateSigningKeyPair();
  const qrToken = signTicketToken(
    { eventId: uuidv7(), attendeeId: uuidv7(), keyVersion: 1, nonce: generateTicketNonce() },
    keys.secretKey,
  );
  const ticket = {
    name: "Ana",
    eventName: "Meetup <GDL>",
    when: "sábado, 10 de octubre de 2026, 18:00",
    where: "Auditorio, Av. Juárez 1",
    url: "https://events.example.org/es-MX/t/abc",
    qrToken,
  };

  it("embeds the QR as an inline PNG referenced by cid", async () => {
    const email = await renderEmail("ticket", "es-MX", ticket);
    expect(email.subject).toBe("Tu boleto para Meetup <GDL>");
    expect(email.html).toContain('src="cid:ticket-qr"');
    expect(email.html).toContain("Meetup &lt;GDL&gt;");
    const [attachment] = email.attachments;
    expect(attachment).toMatchObject({ cid: "ticket-qr", contentType: "image/png" });
    expect(attachment!.content.subarray(1, 4).toString()).toBe("PNG");
  });

  it("never includes the raw QR token in the text or HTML", async () => {
    const email = await renderEmail("ticket", "en", ticket);
    expect(email.text).not.toContain(qrToken);
    expect(email.html).not.toContain(qrToken);
    expect(email.text).toContain(ticket.url);
  });
});

describe("escapeHtml", () => {
  it("escapes all HTML-significant characters", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });
});
