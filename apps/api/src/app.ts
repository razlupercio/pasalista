// SPDX-License-Identifier: AGPL-3.0-or-later
import { getConnInfo } from "@hono/node-server/conninfo";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { Database } from "@pasalista/db";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import type { Context } from "hono";
import type { Logger } from "pino";
import { AUTH_BASE_PATH, type Auth } from "./auth.ts";
import type { Env } from "./env.ts";
import { ApiError, problem } from "./errors.ts";
import { originCheck } from "./middleware/origin-check.ts";
import { MemoryRateLimitStore, rateLimit, type RateLimitStore } from "./middleware/rate-limit.ts";
import { CLIENT_IP_HEADER, requestContext } from "./middleware/request-context.ts";
import { loadKek } from "./crypto/key-encryption.ts";
import { attendeeRoutes, eventRoutes } from "./routes/events.ts";
import { healthRoutes } from "./routes/health.ts";
import { validationHook } from "./routes/openapi.ts";
import { publicRoutes } from "./routes/public.ts";
import { meRoutes, staffInvitationRoutes } from "./routes/staff.ts";
import type { ServiceDeps } from "./services/context.ts";
import type { AppEnv } from "./types.ts";

export const API_PREFIX = "/api/v1";
export const OPENAPI_PATH = `${API_PREFIX}/openapi.json`;

export interface AppDeps {
  env: Env;
  db: Database;
  auth: Auth;
  logger: Logger;
  rateLimitStore?: RateLimitStore;
  /** Clock override for tests. */
  now?: () => Date;
}

export function createApp(deps: AppDeps) {
  const { env, db, auth, logger } = deps;
  const rateLimitStore = deps.rateLimitStore ?? new MemoryRateLimitStore();

  const services: ServiceDeps = {
    db,
    kek: loadKek(env.QR_KEY_ENCRYPTION_KEY, env.QR_KEY_ENCRYPTION_KEY_ID),
    publicUrl: env.PUBLIC_URL,
    ...(deps.now ? { now: deps.now } : {}),
  };

  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });

  app.use(requestId({ headerName: "X-Request-Id" }));
  app.use(
    requestContext({
      logger,
      trustedProxyHops: env.TRUSTED_PROXY_HOPS,
      getSocketAddress: (c) => {
        try {
          return getConnInfo(c).remote.address;
        } catch {
          return undefined; // not running on the Node server (e.g. app.request in tests)
        }
      },
    }),
  );
  app.use(
    secureHeaders({
      contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      crossOriginResourcePolicy: "same-origin",
      referrerPolicy: "no-referrer",
      strictTransportSecurity: env.PUBLIC_URL.startsWith("https://")
        ? "max-age=31536000; includeSubDomains"
        : false,
    }),
  );
  app.use(`${API_PREFIX}/*`, async (c, next) => {
    await next();
    if (!c.res.headers.has("Cache-Control")) c.header("Cache-Control", "no-store");
  });
  app.use(
    `${API_PREFIX}/*`,
    bodyLimit({
      maxSize: 1024 * 1024,
      onError: (c) =>
        problem(c as Context<AppEnv>, 413, "bad_request", { detail: "Payload too large" }),
    }),
  );

  // Better Auth has its own rate limiter; our origin check runs too so CSRF protection does
  // not depend on Better Auth internals (it skips requests without cookies, e.g. sign-up).
  const trustedOrigins = [env.PUBLIC_URL];
  app.use(`${AUTH_BASE_PATH}/*`, originCheck(trustedOrigins));
  app.on(["GET", "POST"], `${AUTH_BASE_PATH}/*`, (c) => {
    const headers = new Headers(c.req.raw.headers);
    headers.set(CLIENT_IP_HEADER, c.get("clientIp"));
    return auth.handler(new Request(c.req.raw, { headers }));
  });

  // Everything else under /api/v1: CSRF origin check and a general rate limit.
  const api = new OpenAPIHono<AppEnv>();
  api.use(originCheck(trustedOrigins));
  api.use(
    rateLimit({
      name: "api",
      windowMs: 60_000,
      max: 300,
      store: rateLimitStore,
      enabled: env.RATE_LIMIT_ENABLED,
    }),
  );
  api.route("/", healthRoutes({ db, version: env.APP_VERSION }));
  api.route("/events", eventRoutes(services, auth));
  api.route("/attendees", attendeeRoutes(services, auth));
  api.route(
    "/staff-invitations",
    staffInvitationRoutes(services, auth, {
      store: rateLimitStore,
      enabled: env.RATE_LIMIT_ENABLED,
    }),
  );
  api.route("/me", meRoutes(services, auth));
  api.route(
    "/public",
    publicRoutes(services, { store: rateLimitStore, enabled: env.RATE_LIMIT_ENABLED }),
  );
  app.route(API_PREFIX, api);
  app.openAPIRegistry.registerComponent("securitySchemes", "session", {
    type: "apiKey",
    in: "cookie",
    name: "pasalista.session_token",
    description: "Better Auth session cookie (web) or `Authorization: Bearer` (mobile)",
  });

  app.doc31(OPENAPI_PATH, {
    openapi: "3.1.0",
    info: {
      title: "PasaLista API",
      version: env.APP_VERSION,
      license: { name: "AGPL-3.0-or-later", url: "https://www.gnu.org/licenses/agpl-3.0.html" },
    },
  });

  app.notFound((c) => problem(c, 404, "not_found"));
  app.onError((error, c) => {
    if (error instanceof ApiError) {
      return problem(c, error.status, error.code, {
        detail: error.message,
        ...(error.issues ? { issues: error.issues } : {}),
      });
    }
    if (error instanceof HTTPException) {
      return problem(c, error.status, "bad_request");
    }
    c.get("logger").error({ err: error }, "unhandled error");
    return problem(c, 500, "internal_error");
  });

  return app;
}

export type App = ReturnType<typeof createApp>;
