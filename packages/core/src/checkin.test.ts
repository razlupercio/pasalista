// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { checkInRequestSchema, checkInWindow, maskEmail } from "./checkin.ts";

describe("checkInWindow", () => {
  const startsAt = new Date("2030-01-15T19:00:00Z");

  it("opens 6 hours before the start and closes at the end", () => {
    const endsAt = new Date("2030-01-15T23:00:00Z");
    expect(checkInWindow({ startsAt, endsAt })).toEqual({
      opensAt: new Date("2030-01-15T13:00:00Z"),
      closesAt: endsAt,
    });
  });

  it("closes 12 hours after the start when there is no end time", () => {
    expect(checkInWindow({ startsAt, endsAt: null }).closesAt).toEqual(
      new Date("2030-01-16T07:00:00Z"),
    );
  });
});

describe("maskEmail", () => {
  it.each([
    ["ana.lopez@gmail.com", "an***@gmail.com"],
    ["ab@x.mx", "a***@x.mx"],
    ["a@x.mx", "a***@x.mx"],
    ["broken", "***"],
  ])("masks %s as %s", (email, masked) => {
    expect(maskEmail(email)).toBe(masked);
  });
});

describe("checkInRequestSchema", () => {
  it("requires a client check-in id for idempotent retries", () => {
    expect(checkInRequestSchema.safeParse({ method: "qr", token: "PL1.x" }).success).toBe(false);
    expect(
      checkInRequestSchema.safeParse({
        method: "qr",
        token: "PL1.x",
        clientCheckInId: "0190f0a0-0000-7000-8000-000000000000",
      }).success,
    ).toBe(true);
  });
});
