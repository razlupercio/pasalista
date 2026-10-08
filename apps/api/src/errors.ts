// SPDX-License-Identifier: AGPL-3.0-or-later
import type { ErrorCode, Problem } from "@pasalista/core";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppEnv } from "./types.ts";

const titles: Record<ErrorCode, string> = {
  bad_request: "Bad request",
  validation_failed: "Validation failed",
  unauthorized: "Unauthorized",
  forbidden: "Forbidden",
  not_found: "Not found",
  conflict: "Conflict",
  rate_limited: "Too many requests",
  invalid_origin: "Invalid origin",
  internal_error: "Internal server error",
};

export class ApiError extends Error {
  readonly status: ContentfulStatusCode;
  readonly code: ErrorCode;
  readonly issues: Problem["issues"];

  constructor(status: ContentfulStatusCode, code: ErrorCode, detail?: string, issues?: Problem["issues"]) {
    super(detail ?? titles[code]);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.issues = issues;
  }
}

/** Builds an RFC 9457 `application/problem+json` response. Never include secrets or personal data. */
export function problem(
  c: Context<AppEnv>,
  status: ContentfulStatusCode,
  code: ErrorCode,
  extra: { detail?: string; issues?: Problem["issues"] } = {},
): Response {
  const body: Problem = {
    type: `urn:pasalista:problem:${code}`,
    title: titles[code],
    status,
    code,
    instance: new URL(c.req.url).pathname,
    requestId: c.get("requestId"),
    ...(extra.detail ? { detail: extra.detail } : {}),
    ...(extra.issues ? { issues: extra.issues } : {}),
  };
  return c.body(JSON.stringify(body), status, { "Content-Type": "application/problem+json" });
}
