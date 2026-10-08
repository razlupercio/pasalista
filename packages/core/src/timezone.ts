// SPDX-License-Identifier: AGPL-3.0-or-later
// Wall-clock <-> instant conversion with the standard Intl API (no date library needed).

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

function zonedParts(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** Offset of `timeZone` from UTC at `instant`, in milliseconds. */
function offsetMs(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

const LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/**
 * Converts a wall-clock time (`YYYY-MM-DDTHH:mm`, as produced by `<input type="datetime-local">`)
 * in `timeZone` to a UTC instant. Times skipped by a DST jump resolve to the later offset.
 */
export function zonedLocalToUtc(local: string, timeZone: string): Date {
  const match = LOCAL_PATTERN.exec(local);
  if (!match) throw new RangeError("Expected YYYY-MM-DDTHH:mm");
  const [, y, mo, d, h, mi] = match.map(Number) as [number, number, number, number, number, number];
  const naiveUtc = Date.UTC(y, mo - 1, d, h, mi);
  // Two passes handle instants near a DST transition.
  let guess = naiveUtc - offsetMs(new Date(naiveUtc), timeZone);
  guess = naiveUtc - offsetMs(new Date(guess), timeZone);
  return new Date(guess);
}

/** Inverse of `zonedLocalToUtc`: formats an instant as `YYYY-MM-DDTHH:mm` in `timeZone`. */
export function utcToZonedLocal(instant: Date, timeZone: string): string {
  const p = zonedParts(instant, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}
