// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Masks path segments that look like secrets (ticket access tokens, reset tokens) so request
 * paths can be logged and echoed in error bodies. UUIDs are masked too; they are not secret but
 * keeping the rule simple avoids leaking anything token-shaped.
 */
export function redactPath(path: string): string {
  return path
    .split("/")
    .map((segment) => (/^[A-Za-z0-9_.~-]{20,}$/.test(segment) ? ":redacted" : segment))
    .join("/");
}
