// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { redactPath } from "./redact.ts";

describe("redactPath", () => {
  it("masks token-shaped segments and keeps the route shape", () => {
    const token = "q0Zb8HnW3m2nWQdP1v7Yt6pX9kLr4sJc2aB5eF8gH1i";
    expect(redactPath(`/api/v1/public/tickets/${token}/qr.png`)).toBe(
      "/api/v1/public/tickets/:redacted/qr.png",
    );
    expect(redactPath("/api/v1/auth/reset-password/abcDEF123456789xyz0001")).toBe(
      "/api/v1/auth/reset-password/:redacted",
    );
  });

  it("leaves ordinary paths alone", () => {
    expect(redactPath("/api/v1/health")).toBe("/api/v1/health");
    expect(redactPath("/api/v1/public/events/meetup-gdl")).toBe("/api/v1/public/events/meetup-gdl");
  });
});
