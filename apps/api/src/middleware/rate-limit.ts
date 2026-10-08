// SPDX-License-Identifier: AGPL-3.0-or-later
import type { MiddlewareHandler } from "hono";
import { problem } from "../errors.ts";
import type { AppEnv } from "../types.ts";

export interface RateLimitStore {
  /** Increments the counter for `key` and returns the new count and window reset time (ms). */
  hit(key: string, windowMs: number, now: number): { count: number; resetAt: number };
}

/**
 * Fixed-window in-memory store. Good enough for a single API instance (MVP); swap for a
 * Postgres-backed store when running several instances (ARCHITECTURE.md §11).
 */
export class MemoryRateLimitStore implements RateLimitStore {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();
  private readonly maxKeys: number;

  constructor(maxKeys = 50_000) {
    this.maxKeys = maxKeys;
  }

  hit(key: string, windowMs: number, now: number) {
    const current = this.windows.get(key);
    if (current && current.resetAt > now) {
      current.count += 1;
      return current;
    }
    if (this.windows.size >= this.maxKeys) this.sweep(now);
    const fresh = { count: 1, resetAt: now + windowMs };
    this.windows.set(key, fresh);
    return fresh;
  }

  private sweep(now: number) {
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
  }
}

export function rateLimit(options: {
  name: string;
  windowMs: number;
  max: number;
  store: RateLimitStore;
  enabled?: boolean;
  now?: () => number;
}): MiddlewareHandler<AppEnv> {
  const now = options.now ?? Date.now;
  return async (c, next) => {
    if (options.enabled === false) return next();
    const { count, resetAt } = options.store.hit(
      `${options.name}:${c.get("clientIp")}`,
      options.windowMs,
      now(),
    );
    const remaining = Math.max(0, options.max - count);
    c.header("RateLimit-Limit", String(options.max));
    c.header("RateLimit-Remaining", String(remaining));
    if (count > options.max) {
      c.header("Retry-After", String(Math.max(1, Math.ceil((resetAt - now()) / 1000))));
      return problem(c, 429, "rate_limited");
    }
    return next();
  };
}
