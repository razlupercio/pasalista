// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import {
  eventInputSchema,
  purgeReminderDue,
  validateAnswers,
  type EventInput,
  type RegistrationField,
} from "./events.ts";

const base: EventInput = {
  name: "Meetup",
  description: null,
  startsAt: "2026-11-10T00:00:00.000Z",
  endsAt: "2026-11-10T03:00:00.000Z",
  timezone: "America/Mexico_City",
  venueName: "Auditorio",
  venueAddress: null,
  capacity: 100,
  registrationMode: "open",
  registrationDeadline: null,
  registrationFields: [],
};

describe("eventInputSchema", () => {
  it("accepts a valid event", () => {
    expect(eventInputSchema.safeParse(base).success).toBe(true);
  });

  it("requires endsAt after startsAt and a deadline before the end", () => {
    expect(eventInputSchema.safeParse({ ...base, endsAt: base.startsAt }).success).toBe(false);
    expect(
      eventInputSchema.safeParse({ ...base, registrationDeadline: "2026-11-11T00:00:00.000Z" })
        .success,
    ).toBe(false);
  });

  it("rejects unknown time zones and duplicate field keys", () => {
    expect(eventInputSchema.safeParse({ ...base, timezone: "Nowhere/City" }).success).toBe(false);
    const field = { type: "text", key: "f1", label: "Company", required: false } as const;
    expect(
      eventInputSchema.safeParse({ ...base, registrationFields: [field, field] }).success,
    ).toBe(false);
  });

  it("limits the number of extra fields to 10", () => {
    const fields = Array.from({ length: 11 }, (_, i) => ({
      type: "text" as const,
      key: `f${i}`,
      label: `Field ${i}`,
      required: false,
    }));
    expect(eventInputSchema.safeParse({ ...base, registrationFields: fields }).success).toBe(false);
  });
});

describe("validateAnswers", () => {
  const fields: RegistrationField[] = [
    { type: "text", key: "company", label: "Company", required: true },
    { type: "select", key: "size", label: "T-shirt", required: false, options: ["S", "M", "L"] },
    { type: "checkbox", key: "terms", label: "I accept", required: true },
  ];

  it("normalizes valid answers", () => {
    expect(validateAnswers(fields, { company: "  ACME ", size: "M", terms: true })).toEqual({
      ok: true,
      answers: { company: "ACME", size: "M", terms: true },
    });
  });

  it("reports missing required answers, invalid options and unknown keys", () => {
    const result = validateAnswers(fields, { company: " ", size: "XL", terms: false, extra: "x" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          { key: "company", problem: "required" },
          { key: "size", problem: "invalid" },
          { key: "terms", problem: "required" },
          { key: "extra", problem: "unknown" },
        ]),
      );
    }
  });

  it("treats an unchecked optional checkbox as false", () => {
    const optional: RegistrationField[] = [
      { type: "checkbox", key: "news", label: "News", required: false },
    ];
    expect(validateAnswers(optional, {})).toEqual({ ok: true, answers: { news: false } });
  });
});

describe("purgeReminderDue", () => {
  const ended = { startsAt: "2026-01-01T18:00:00.000Z", endsAt: "2026-01-01T21:00:00.000Z" };
  it("reminds 90 days after the end, never for purged events", () => {
    expect(purgeReminderDue({ ...ended, purgedAt: null }, new Date("2026-03-31T00:00:00Z"))).toBe(
      false,
    );
    expect(purgeReminderDue({ ...ended, purgedAt: null }, new Date("2026-04-02T00:00:00Z"))).toBe(
      true,
    );
    expect(
      purgeReminderDue(
        { ...ended, purgedAt: "2026-02-01T00:00:00.000Z" },
        new Date("2027-01-01T00:00:00Z"),
      ),
    ).toBe(false);
  });
  it("uses the start when there is no end", () => {
    const now = new Date("2026-04-02T00:00:00Z");
    expect(purgeReminderDue({ startsAt: ended.startsAt, endsAt: null, purgedAt: null }, now)).toBe(
      true,
    );
  });
});
