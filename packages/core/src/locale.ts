// SPDX-License-Identifier: AGPL-3.0-or-later
import { z } from "zod";

export const locales = ["es-MX", "en"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "es-MX";

export const localeSchema = z.enum(locales);

export function isLocale(value: unknown): value is Locale {
  return localeSchema.safeParse(value).success;
}
