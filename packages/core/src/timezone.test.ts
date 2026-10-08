// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { isValidTimeZone, utcToZonedLocal, zonedLocalToUtc } from "./timezone.ts";

describe("time zones", () => {
  it("validates IANA names", () => {
    expect(isValidTimeZone("America/Mexico_City")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus_Mons")).toBe(false);
  });

  it("converts wall-clock time to UTC (Mexico City has no DST since 2022)", () => {
    expect(zonedLocalToUtc("2026-10-10T18:00", "America/Mexico_City").toISOString()).toBe(
      "2026-10-11T00:00:00.000Z",
    );
  });

  it("handles both sides of a DST change", () => {
    expect(zonedLocalToUtc("2026-03-07T12:00", "America/New_York").toISOString()).toBe(
      "2026-03-07T17:00:00.000Z",
    );
    expect(zonedLocalToUtc("2026-03-09T12:00", "America/New_York").toISOString()).toBe(
      "2026-03-09T16:00:00.000Z",
    );
  });

  it("round-trips", () => {
    for (const zone of ["UTC", "America/Tijuana", "Europe/Madrid", "Asia/Kolkata"]) {
      const local = "2026-11-02T09:30";
      expect(utcToZonedLocal(zonedLocalToUtc(local, zone), zone)).toBe(local);
    }
  });

  it("rejects malformed input", () => {
    expect(() => zonedLocalToUtc("2026-10-10 18:00", "UTC")).toThrow(RangeError);
  });
});
