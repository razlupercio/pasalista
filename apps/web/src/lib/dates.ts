// SPDX-License-Identifier: AGPL-3.0-or-later
import type { DateTimeFormatOptions } from "next-intl";

/** Options for showing event times in the event's own time zone (with the zone name). */
export function eventDateTimeOptions(timeZone: string): DateTimeFormatOptions {
  return { dateStyle: "full", timeStyle: "short", timeZone };
}

export function timeZoneOptions(): string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return ["UTC"];
  }
}
