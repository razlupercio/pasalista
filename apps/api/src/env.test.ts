// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { DEV_AUTH_SECRET, loadEnv } from "./env.ts";

const production = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://u:p@db:5432/pasalista",
  PUBLIC_URL: "https://events.example.org/",
  BETTER_AUTH_SECRET: "x".repeat(48),
  SMTP_HOST: "smtp.example.org",
  SMTP_PORT: "587",
  EMAIL_FROM: "PasaLista <no-reply@example.org>",
};

describe("loadEnv", () => {
  it("applies development defaults so `pnpm dev` works without a .env file", () => {
    const env = loadEnv({});
    expect(env.NODE_ENV).toBe("development");
    expect(env.PUBLIC_URL).toBe("http://localhost:3000");
    expect(env.TRUSTED_PROXY_HOPS).toBe(1);
  });

  it("requires every variable in production and normalizes the public URL", () => {
    const env = loadEnv(production);
    expect(env.PUBLIC_URL).toBe("https://events.example.org");
    expect(env.TRUSTED_PROXY_HOPS).toBe(0);
    expect(() => loadEnv({ NODE_ENV: "production" })).toThrow(/DATABASE_URL/);
  });

  it("refuses the development secret in production", () => {
    expect(() => loadEnv({ ...production, BETTER_AUTH_SECRET: DEV_AUTH_SECRET })).toThrow(
      /BETTER_AUTH_SECRET/,
    );
  });

  it("never echoes secret values in errors", () => {
    const secret = "short-secret-value";
    expect(() => loadEnv({ ...production, BETTER_AUTH_SECRET: secret })).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining(secret) as unknown }),
    );
  });
});
