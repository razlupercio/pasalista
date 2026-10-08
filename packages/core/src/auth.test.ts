// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { emailSchema, passwordSchema, signUpInputSchema } from "./auth.ts";

describe("auth schemas", () => {
  it("normalizes emails to trimmed lowercase", () => {
    expect(emailSchema.parse("  Ana.Lopez@Example.COM ")).toBe("ana.lopez@example.com");
  });

  it("rejects malformed emails", () => {
    expect(emailSchema.safeParse("not-an-email").success).toBe(false);
  });

  it("enforces password length bounds (ASVS L1)", () => {
    expect(passwordSchema.safeParse("a".repeat(11)).success).toBe(false);
    expect(passwordSchema.safeParse("a".repeat(12)).success).toBe(true);
    expect(passwordSchema.safeParse("a".repeat(129)).success).toBe(false);
  });

  it("requires a supported locale on sign-up", () => {
    const base = { name: "Ana", email: "ana@example.com", password: "correct horse battery" };
    expect(signUpInputSchema.safeParse({ ...base, locale: "es-MX" }).success).toBe(true);
    expect(signUpInputSchema.safeParse({ ...base, locale: "fr" }).success).toBe(false);
  });
});
