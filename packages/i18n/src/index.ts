// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Locale } from "@pasalista/core";
import en from "../messages/en.json" with { type: "json" };
import esMX from "../messages/es-MX.json" with { type: "json" };

/** es-MX is the reference catalog; every other locale must have exactly the same keys. */
export type Messages = typeof esMX;

export const messages: Record<Locale, Messages> = {
  "es-MX": esMX,
  en,
};

/**
 * Minimal `{placeholder}` interpolation for non-React contexts (emails). Catalogs only use
 * simple placeholders so they stay compatible with ICU (next-intl) on the web.
 */
export function format(template: string, values: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}
