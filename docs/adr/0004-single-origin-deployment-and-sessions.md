# ADR-0004: Single-origin deployment and session handling

- Status: Proposed
- Date: 2026-10-08

## Context

The web app (Next.js) and the API (Hono) are separate services. Cookie sessions across two
origins require CORS with credentials, `SameSite=None` cookies and stronger CSRF defenses.
The future Expo app cannot rely on browser cookies.

## Decision

- The browser always talks to **one origin**. Next.js rewrites `/api/*` to the API container
  (`API_INTERNAL_URL`); production deployments may use any reverse proxy with the same
  routing. Docker Compose keeps the four services from the brief.
- Better Auth is mounted in the API at `/v1/auth/*` (public path `/api/v1/auth/*`).
- Web sessions: HTTP-only, `Secure`, `SameSite=Lax`, host-only cookies.
- CSRF: Better Auth's origin check on auth routes; on every other state-changing route a
  middleware requires a trusted `Origin` (or `Sec-Fetch-Site: same-origin`) and a JSON or
  multipart content type. CORS is off by default; an allowlist can be configured.
- Expo (future): Better Auth's Expo plugin with bearer tokens in secure storage; bearer
  requests are not subject to the cookie CSRF rules.

## Consequences

- No CORS needed for the main web app; simpler and safer defaults.
- The API remains directly reachable for mobile and integrations.
- The Next.js server proxies API traffic; CSV uploads and polling must stay within its
  limits, which is acceptable at MVP sizes.
