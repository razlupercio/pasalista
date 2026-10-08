// SPDX-License-Identifier: AGPL-3.0-or-later
import { uuidv7 } from "@pasalista/core";
import { createDb, schema } from "@pasalista/db";
import { desc, eq } from "drizzle-orm";
import { pino } from "pino";
import { createApp } from "../src/app.ts";
import { createAuth } from "../src/auth.ts";
import { loadEnv } from "../src/env.ts";
import { TEST_DATABASE_URL } from "./database-url.ts";

export const ORIGIN = "http://localhost:3000";

export function createTestContext(overrides: Record<string, string> = {}) {
  const env = loadEnv({
    NODE_ENV: "test",
    DATABASE_URL: TEST_DATABASE_URL,
    PUBLIC_URL: ORIGIN,
    TRUSTED_PROXY_HOPS: "1",
    LOG_LEVEL: "silent",
    EMAIL_WORKER_ENABLED: "false",
    ...overrides,
  });
  const { db, pool } = createDb(env.DATABASE_URL, { max: 5 });
  const auth = createAuth({ db, env });
  const app = createApp({ env, db, auth, logger: pino({ level: "silent" }) });
  return { env, db, auth, app, close: () => pool.end() };
}

export type TestContext = ReturnType<typeof createTestContext>;

export function uniqueEmail(label = "user"): string {
  return `${label}-${uuidv7()}@example.test`;
}

/** A random client IP so per-IP rate limits do not leak between tests. */
export function randomIp(): string {
  const n = () => Math.floor(Math.random() * 254) + 1;
  return `10.${n()}.${n()}.${n()}`;
}

export function jsonRequest(
  method: string,
  body: unknown,
  extra: { ip?: string; origin?: string | null; cookie?: string } = {},
): RequestInit {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-forwarded-for": extra.ip ?? randomIp(),
  };
  if (extra.origin !== null) headers.origin = extra.origin ?? ORIGIN;
  if (extra.cookie) headers.cookie = extra.cookie;
  return { method, headers, body: JSON.stringify(body) };
}

export function cookiesFrom(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

export async function latestEmail(ctx: TestContext, to: string) {
  const [row] = await ctx.db
    .select()
    .from(schema.emailOutbox)
    .where(eq(schema.emailOutbox.toEmail, to))
    .orderBy(desc(schema.emailOutbox.createdAt))
    .limit(1);
  return row;
}

/** Turns an absolute link from an email into a path the in-memory app can serve. */
export function pathOf(url: unknown): string {
  const parsed = new URL(String(url));
  return parsed.pathname + parsed.search;
}

export const PASSWORD = "correct horse battery staple";

export async function signUp(ctx: TestContext, email: string, locale = "es-MX") {
  return ctx.app.request(
    "/api/v1/auth/sign-up/email",
    jsonRequest("POST", { name: "Ana López", email, password: PASSWORD, locale }),
  );
}

export async function signUpAndVerify(ctx: TestContext, email: string): Promise<string> {
  await signUp(ctx, email);
  const mail = await latestEmail(ctx, email);
  const response = await ctx.app.request(pathOf(mail?.payload.url), {
    headers: { "x-forwarded-for": randomIp() },
  });
  return cookiesFrom(response);
}

/** A signed-in organizer: returns the session cookie. */
export function newOrganizer(ctx: TestContext): Promise<string> {
  return signUpAndVerify(ctx, uniqueEmail("organizer"));
}

/** JSON request helper. `cookie: null` sends an anonymous request. */
export async function api<T = unknown>(
  ctx: TestContext,
  method: string,
  path: string,
  options: { cookie?: string | null; body?: unknown; ip?: string } = {},
): Promise<{ status: number; body: T; response: Response }> {
  const init = jsonRequest(method, options.body ?? {}, {
    ...(options.cookie ? { cookie: options.cookie } : {}),
    ...(options.ip ? { ip: options.ip } : {}),
  });
  if (method === "GET" || method === "DELETE") delete init.body;
  const response = await ctx.app.request(path, init);
  const text = await response.clone().text();
  return { status: response.status, body: (text ? JSON.parse(text) : null) as T, response };
}

const DAY = 24 * 60 * 60 * 1000;

export function eventInput(overrides: Record<string, unknown> = {}) {
  const start = new Date(Date.now() + 30 * DAY);
  return {
    name: "Meetup de prueba",
    description: "Una noche de charlas",
    startsAt: start.toISOString(),
    endsAt: new Date(start.getTime() + 3 * 60 * 60 * 1000).toISOString(),
    timezone: "America/Mexico_City",
    venueName: "Auditorio Central",
    venueAddress: "Av. Juárez 1, Guadalajara",
    capacity: null,
    registrationMode: "open",
    registrationDeadline: null,
    registrationFields: [],
    ...overrides,
  };
}

export interface EventBody {
  id: string;
  slug: string;
  status: string;
  registeredCount: number;
  organizationId: string;
}

export async function createEvent(
  ctx: TestContext,
  cookie: string,
  overrides: Record<string, unknown> = {},
) {
  const created = await api<EventBody>(ctx, "POST", "/api/v1/events", {
    cookie,
    body: eventInput(overrides),
  });
  if (created.status !== 201) throw new Error(`create failed: ${JSON.stringify(created.body)}`);
  return created.body;
}

export async function createPublishedEvent(
  ctx: TestContext,
  cookie: string,
  overrides: Record<string, unknown> = {},
): Promise<EventBody> {
  const event = await createEvent(ctx, cookie, overrides);
  const published = await api<EventBody>(ctx, "POST", `/api/v1/events/${event.id}/publish`, {
    cookie,
  });
  if (published.status !== 200) throw new Error("publish failed");
  return published.body;
}

export function register(
  ctx: TestContext,
  slug: string,
  input: { email: string; name?: string; locale?: string; answers?: Record<string, unknown> },
  ip?: string,
) {
  return api<{ code?: string; issues?: { path: unknown[] }[] }>(
    ctx,
    "POST",
    `/api/v1/public/events/${slug}/registrations`,
    {
      body: { name: "Asistente Uno", locale: "es-MX", answers: {}, ...input },
      ...(ip ? { ip } : {}),
    },
  );
}

/** The secret "my ticket" token from the latest ticket email sent to `email`. */
export async function ticketAccessToken(ctx: TestContext, email: string): Promise<string> {
  const mail = await latestEmail(ctx, email);
  if (mail?.kind !== "ticket") throw new Error("No ticket email");
  return new URL(String(mail.payload.url)).pathname.split("/").at(-1)!;
}
