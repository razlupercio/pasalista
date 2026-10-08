// SPDX-License-Identifier: AGPL-3.0-or-later
import { Hono, type MiddlewareHandler } from "hono";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import type { AppEnv } from "../types.ts";
import { originCheck } from "./origin-check.ts";
import { MemoryRateLimitStore, rateLimit } from "./rate-limit.ts";
import { requestContext, resolveClientIp } from "./request-context.ts";

describe("resolveClientIp", () => {
  it("ignores X-Forwarded-For when no proxy is trusted", () => {
    expect(resolveClientIp("1.1.1.1", "10.0.0.1", 0)).toBe("10.0.0.1");
  });

  it("takes the entry appended by the trusted proxy, not the client-supplied ones", () => {
    // Client sent "6.6.6.6" itself; our proxy appended the real address 2.2.2.2.
    expect(resolveClientIp("6.6.6.6, 2.2.2.2", "10.0.0.1", 1)).toBe("2.2.2.2");
    expect(resolveClientIp("6.6.6.6, 2.2.2.2, 3.3.3.3", "10.0.0.1", 2)).toBe("2.2.2.2");
  });

  it("falls back to the socket address when the header is shorter than the hop count", () => {
    expect(resolveClientIp("2.2.2.2", "10.0.0.1", 2)).toBe("10.0.0.1");
    expect(resolveClientIp(undefined, undefined, 1)).toBe("unknown");
  });
});

function testApp(...middleware: MiddlewareHandler<AppEnv>[]) {
  const app = new Hono<AppEnv>();
  app.use(async (c, next) => {
    c.set("requestId", "test");
    await next();
  });
  app.use(
    requestContext({
      logger: pino({ level: "silent" }),
      trustedProxyHops: 1,
      getSocketAddress: () => undefined,
    }),
  );
  for (const m of middleware) app.use(m);
  app.all("/thing", (c) => c.json({ ok: true }));
  return app;
}

describe("rateLimit", () => {
  it("allows up to max requests per window and then answers 429 with Retry-After", async () => {
    let now = 0;
    const app = testApp(
      rateLimit({
        name: "t",
        windowMs: 1_000,
        max: 2,
        store: new MemoryRateLimitStore(),
        now: () => now,
      }),
    );
    const hit = () => app.request("/thing", { headers: { "x-forwarded-for": "9.9.9.9" } });

    expect((await hit()).status).toBe(200);
    expect((await hit()).status).toBe(200);
    const limited = await hit();
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("1");
    expect(((await limited.json()) as { code: string }).code).toBe("rate_limited");

    now = 1_000; // new window
    expect((await hit()).status).toBe(200);
  });

  it("counts each client IP separately", async () => {
    const app = testApp(
      rateLimit({ name: "t", windowMs: 60_000, max: 1, store: new MemoryRateLimitStore() }),
    );
    expect(
      (await app.request("/thing", { headers: { "x-forwarded-for": "1.1.1.1" } })).status,
    ).toBe(200);
    expect(
      (await app.request("/thing", { headers: { "x-forwarded-for": "2.2.2.2" } })).status,
    ).toBe(200);
    expect(
      (await app.request("/thing", { headers: { "x-forwarded-for": "1.1.1.1" } })).status,
    ).toBe(429);
  });
});

describe("originCheck", () => {
  const app = testApp(originCheck(["http://localhost:3000"]));

  it("lets safe methods through", async () => {
    expect((await app.request("/thing")).status).toBe(200);
  });

  it("accepts state-changing requests from a trusted origin", async () => {
    const response = await app.request("/thing", {
      method: "POST",
      headers: { origin: "http://localhost:3000" },
    });
    expect(response.status).toBe(200);
  });

  it("accepts same-origin requests without an Origin header", async () => {
    const response = await app.request("/thing", {
      method: "POST",
      headers: { "sec-fetch-site": "same-origin" },
    });
    expect(response.status).toBe(200);
  });

  it("rejects foreign or missing origins", async () => {
    expect(
      (await app.request("/thing", { method: "POST", headers: { origin: "https://evil.example" } }))
        .status,
    ).toBe(403);
    expect((await app.request("/thing", { method: "DELETE" })).status).toBe(403);
  });

  it("exempts bearer-token clients", async () => {
    const response = await app.request("/thing", {
      method: "POST",
      headers: { authorization: "Bearer abc" },
    });
    expect(response.status).toBe(200);
  });
});
