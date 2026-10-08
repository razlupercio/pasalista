// SPDX-License-Identifier: AGPL-3.0-or-later
import type { MiddlewareHandler } from "hono";
import type { Logger } from "pino";
import type { AppEnv } from "../types.ts";

/**
 * Resolves the client IP. `X-Forwarded-For` is only trusted for the number of proxies we
 * control (`trustedProxyHops`): each proxy appends the address it saw, so the client IP is
 * the entry `hops` positions from the right. Entries further left are client-controlled.
 */
export function resolveClientIp(
  forwardedFor: string | undefined,
  socketAddress: string | undefined,
  trustedProxyHops: number,
): string {
  if (trustedProxyHops > 0 && forwardedFor) {
    const chain = forwardedFor
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    const candidate = chain[chain.length - trustedProxyHops];
    if (candidate) return candidate;
  }
  return socketAddress ?? "unknown";
}

/** Header used to hand the resolved client IP to Better Auth (its rate limiter keys on it). */
export const CLIENT_IP_HEADER = "x-pasalista-client-ip";

export function requestContext(options: {
  logger: Logger;
  trustedProxyHops: number;
  getSocketAddress: (c: Parameters<MiddlewareHandler<AppEnv>>[0]) => string | undefined;
}): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const requestId = c.get("requestId");
    const clientIp = resolveClientIp(
      c.req.header("x-forwarded-for"),
      options.getSocketAddress(c),
      options.trustedProxyHops,
    );
    const logger = options.logger.child({ requestId });
    c.set("clientIp", clientIp);
    c.set("logger", logger);

    const start = performance.now();
    await next();
    // Path only: query strings may carry one-time tokens (verification, reset links).
    logger.info(
      {
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        durationMs: Math.round(performance.now() - start),
      },
      "request",
    );
  };
}
