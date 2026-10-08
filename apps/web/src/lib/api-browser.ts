// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { createApiClient } from "@pasalista/api-client";
import type { Messages } from "@pasalista/i18n";

/** Typed API client for Client Components (same origin, session cookie included). */
export const browserApi = createApiClient({ baseUrl: "" });

export type ApiErrorKey = keyof Messages["apiErrors"];

const known = new Set<string>([
  "validation_failed",
  "not_found",
  "unauthorized",
  "forbidden",
  "already_registered",
  "event_full",
  "registration_closed",
  "invalid_state",
  "rate_limited",
]);

/** Maps an RFC 9457 problem (or anything else) to an i18n key under `apiErrors`. */
export function apiErrorKey(error: unknown): ApiErrorKey {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && known.has(code) ? (code as ApiErrorKey) : "generic";
}

export interface FieldIssue {
  path: (string | number)[];
  message: string;
}

export function problemIssues(error: unknown): FieldIssue[] {
  const issues = (error as { issues?: unknown } | null)?.issues;
  return Array.isArray(issues) ? (issues as FieldIssue[]) : [];
}
