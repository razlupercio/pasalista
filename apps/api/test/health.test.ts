// SPDX-License-Identifier: AGPL-3.0-or-later
import { healthResponseSchema, problemSchema } from "@pasalista/core";
import { afterAll, describe, expect, it } from "vitest";
import { createTestContext } from "./helpers.ts";

const ctx = createTestContext();
afterAll(() => ctx.close());

describe("GET /api/v1/health", () => {
  it("reports the API and database as healthy", async () => {
    const response = await ctx.app.request("/api/v1/health");
    expect(response.status).toBe(200);
    expect(healthResponseSchema.parse(await response.json())).toMatchObject({
      status: "ok",
      database: "ok",
    });
  });

  it("sets security headers, a request id and no-store caching", async () => {
    const response = await ctx.app.request("/api/v1/health");
    expect(response.headers.get("x-request-id")).toBeTruthy();
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("reports degraded when the database is unreachable", async () => {
    const broken = createTestContext({
      DATABASE_URL: "postgres://nobody:nothing@127.0.0.1:1/none",
    });
    try {
      const response = await broken.app.request("/api/v1/health");
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ status: "degraded", database: "unavailable" });
    } finally {
      await broken.close();
    }
  });
});

describe("errors", () => {
  it("answers unknown routes with RFC 9457 problem details", async () => {
    const response = await ctx.app.request("/api/v1/does-not-exist");
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
    const body = problemSchema.parse(await response.json());
    expect(body).toMatchObject({
      status: 404,
      code: "not_found",
      instance: "/api/v1/does-not-exist",
    });
    expect(body.requestId).toBe(response.headers.get("x-request-id"));
  });
});

describe("OpenAPI", () => {
  it("documents the health route", async () => {
    const response = await ctx.app.request("/api/v1/openapi.json");
    expect(response.status).toBe(200);
    const document = (await response.json()) as { openapi: string; paths: Record<string, unknown> };
    expect(document.openapi).toBe("3.1.0");
    expect(document.paths).toHaveProperty("/api/v1/health");
  });
});
