// SPDX-License-Identifier: AGPL-3.0-or-later
import type { MiddlewareHandler } from "hono";
import { problem } from "../errors.ts";
import type { AppEnv } from "../types.ts";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF defense for cookie-authenticated requests (ADR-0004): state-changing requests must
 * come from a trusted origin. Bearer-token clients (mobile) are exempt because browsers
 * never attach that header automatically.
 */
export function originCheck(trustedOrigins: readonly string[]): MiddlewareHandler<AppEnv> {
  const trusted = new Set(trustedOrigins);
  return async (c, next) => {
    if (SAFE_METHODS.has(c.req.method)) return next();
    if (c.req.header("authorization")?.startsWith("Bearer ")) return next();

    const origin = c.req.header("origin");
    const allowed = origin
      ? trusted.has(origin)
      : c.req.header("sec-fetch-site") === "same-origin";
    if (!allowed) return problem(c, 403, "invalid_origin");
    return next();
  };
}
