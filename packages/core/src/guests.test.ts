// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { planGuestImport } from "./guests.ts";

describe("planGuestImport", () => {
  it("normalizes valid rows and applies the default locale", () => {
    const plan = planGuestImport(
      [
        { line: 2, name: " Ana López ", email: "ANA@Example.com", locale: null },
        { line: 3, name: "Sam", email: "sam@example.com", locale: "en" },
      ],
      "es-MX",
    );
    expect(plan.guests).toEqual([
      { line: 2, name: "Ana López", email: "ana@example.com", locale: "es-MX" },
      { line: 3, name: "Sam", email: "sam@example.com", locale: "en" },
    ]);
    expect(plan.skipped).toEqual([]);
  });

  it("reports each problem with its line and keeps the first of duplicate emails", () => {
    const plan = planGuestImport(
      [
        { line: 2, name: "Ana", email: "ana@example.com", locale: null },
        { line: 3, name: "Ana again", email: "ANA@example.com", locale: null },
        { line: 4, name: "", email: "x@example.com", locale: null },
        { line: 5, name: "Bad", email: "not-an-email", locale: null },
        { line: 6, name: "Fr", email: "fr@example.com", locale: "fr" },
      ],
      "en",
    );
    expect(plan.guests.map((g) => g.line)).toEqual([2]);
    expect(plan.skipped).toEqual([
      { line: 3, email: "ANA@example.com", problem: "duplicate_in_file" },
      { line: 4, email: "x@example.com", problem: "invalid_name" },
      { line: 5, email: "not-an-email", problem: "invalid_email" },
      { line: 6, email: "fr@example.com", problem: "invalid_locale" },
    ]);
  });
});
