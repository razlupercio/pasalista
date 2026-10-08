// SPDX-License-Identifier: AGPL-3.0-or-later
import type { MiddlewareHandler } from "hono";
import type { Auth } from "../auth.ts";
import { problem } from "../errors.ts";
import type { AuthedEnv } from "../types.ts";

/** Resolves the Better Auth session (cookie or bearer) and rejects anonymous requests with 401. */
export function requireUser(auth: Auth): MiddlewareHandler<AuthedEnv> {
  return async (c, next) => {
    const result = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!result) return problem(c, 401, "unauthorized");
    const { id, name, email, emailVerified } = result.user;
    c.set("user", { id, name, email, emailVerified });
    c.set("activeOrganizationId", result.session.activeOrganizationId ?? null);
    return next();
  };
}
