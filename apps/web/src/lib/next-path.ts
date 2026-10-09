// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Validates a post-sign-in destination taken from the URL. Only same-site paths without a
 * locale prefix are accepted, so `?next=` cannot be abused as an open redirect.
 */
export function safeNextPath(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 300) return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;
  if (!/^\/[A-Za-z0-9/_\-.~?=&%]*$/.test(value)) return null;
  return value;
}
