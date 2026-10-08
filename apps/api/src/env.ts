// SPDX-License-Identifier: AGPL-3.0-or-later
import { DEFAULT_DEV_DATABASE_URL } from "@pasalista/db";
import { z } from "zod";

/** Development-only secret. The API refuses to start with it when NODE_ENV=production. */
export const DEV_AUTH_SECRET = "dev-only-insecure-secret-change-me-0000000000";

/** Development-only key-encryption key (32 bytes, base64url). Refused in production. */
export const DEV_QR_KEY_ENCRYPTION_KEY = "ZGV2LW9ubHktaW5zZWN1cmUta2VrLWNoYW5nZS1tZSE";

const base64Url32Bytes = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/, "must be 32 bytes encoded as base64url (43 characters)");

const booleanString = z
  .enum(["true", "false", "1", "0"])
  .transform((value) => value === "true" || value === "1");

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    APP_VERSION: z.string().default("0.1.0"),
    DATABASE_URL: z.url(),
    /** Public origin of the web app (single origin, see ADR-0004). Used for links and CSRF checks. */
    PUBLIC_URL: z.url().transform((url) => url.replace(/\/+$/, "")),
    BETTER_AUTH_SECRET: z.string().min(32),
    /** Encrypts per-event QR signing keys at rest (AES-256-GCM, ADR-0002). */
    QR_KEY_ENCRYPTION_KEY: base64Url32Bytes,
    /** Identifier stored with each encrypted key so the KEK can be rotated later. */
    QR_KEY_ENCRYPTION_KEY_ID: z
      .string()
      .regex(/^[a-z0-9-]{1,32}$/)
      .default("k1"),
    /**
     * Number of reverse proxies we control that append the client address to
     * `X-Forwarded-For` (e.g. nginx, Caddy, Traefik). The Next.js rewrite does NOT count: it
     * forwards a client-supplied header unchanged. 0 ignores the header; too high a value lets
     * clients spoof their IP and dodge rate limits.
     */
    TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
    RATE_LIMIT_ENABLED: booleanString.default(true),
    EMAIL_WORKER_ENABLED: booleanString.default(true),
    SMTP_HOST: z.string().min(1),
    SMTP_PORT: z.coerce.number().int().min(1).max(65_535),
    SMTP_SECURE: booleanString.default(false),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    EMAIL_FROM: z.string().min(3),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === "production" && env.BETTER_AUTH_SECRET === DEV_AUTH_SECRET) {
      ctx.addIssue({
        code: "custom",
        path: ["BETTER_AUTH_SECRET"],
        message: "The development secret cannot be used in production",
      });
    }
    if (env.NODE_ENV === "production" && env.QR_KEY_ENCRYPTION_KEY === DEV_QR_KEY_ENCRYPTION_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["QR_KEY_ENCRYPTION_KEY"],
        message: "The development key-encryption key cannot be used in production",
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

/** Defaults that match docker-compose.yml so `pnpm dev` works without a .env file. */
const developmentDefaults: Record<string, string> = {
  DATABASE_URL: DEFAULT_DEV_DATABASE_URL,
  PUBLIC_URL: "http://localhost:3000",
  BETTER_AUTH_SECRET: DEV_AUTH_SECRET,
  QR_KEY_ENCRYPTION_KEY: DEV_QR_KEY_ENCRYPTION_KEY,
  SMTP_HOST: "localhost",
  SMTP_PORT: "1025",
  EMAIL_FROM: "PasaLista <no-reply@pasalista.localhost>",
};

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const isProduction = source.NODE_ENV === "production";
  const merged = isProduction ? source : { ...developmentDefaults, ...stripEmpty(source) };
  const result = envSchema.safeParse(merged);
  if (!result.success) {
    // Only variable names and messages: never print values, they may be secrets.
    const problems = result.error.issues.map(
      (issue) => `${issue.path.join(".")}: ${issue.message}`,
    );
    throw new Error(`Invalid environment configuration:\n- ${problems.join("\n- ")}`);
  }
  return result.data;
}

function stripEmpty(source: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(source).filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
}
