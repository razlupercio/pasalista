// SPDX-License-Identifier: AGPL-3.0-or-later
import { defaultLocale, type Locale, locales } from "@pasalista/core";
import { hasLocale } from "next-intl";
import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales,
  defaultLocale,
  localePrefix: "always",
});

/** Narrows a `[locale]` route param (already validated by the layout) to a supported locale. */
export function toLocale(value: string): Locale {
  return hasLocale(routing.locales, value) ? value : routing.defaultLocale;
}
