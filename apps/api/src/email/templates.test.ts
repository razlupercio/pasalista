// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { escapeHtml, renderEmail } from "./templates.ts";

describe("renderEmail", () => {
  const payload = { name: "Ana", url: "https://events.example.org/api/v1/auth/verify-email?token=t" };

  it("renders in the recipient locale", () => {
    expect(renderEmail("verify_email", "es-MX", payload).subject).toBe("Verifica tu correo en PasaLista");
    expect(renderEmail("verify_email", "en", payload).subject).toBe("Verify your email on PasaLista");
  });

  it("falls back to the default locale for unknown locales", () => {
    expect(renderEmail("verify_email", "fr", payload).subject).toBe("Verifica tu correo en PasaLista");
  });

  it("escapes user-controlled values in HTML", () => {
    const html = renderEmail("verify_email", "en", { ...payload, name: '<script>alert("x")</script>' }).html;
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("includes the link in the plain-text part", () => {
    expect(renderEmail("magic_link", "en", { url: payload.url }).text).toContain(payload.url);
  });

  it("rejects payloads that do not match the email kind", () => {
    expect(() => renderEmail("magic_link", "en", { url: "javascript:alert(1)" })).toThrow();
  });
});

describe("escapeHtml", () => {
  it("escapes all HTML-significant characters", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });
});
