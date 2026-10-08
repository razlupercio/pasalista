# ADR-0006: Toolchain and TypeScript runtime

- Status: Proposed
- Date: 2026-10-08

## Context

Phase 1 scaffolds the monorepo. We need to decide how TypeScript runs on the server, which
TypeScript and ESLint versions to use, and how rate limiting identifies clients behind the
Next.js rewrite.

## Decision

**Node runs TypeScript directly.** The API and the database scripts run `.ts` files with
Node's built-in type stripping (stable since Node 23.6; Node 24 LTS in Docker). There is no
build step and no extra runtime dependency (`tsx`, `ts-node`, bundlers). Consequences for the
code: `erasableSyntaxOnly` (no enums, no parameter properties, no namespaces),
`verbatimModuleSyntax`, and relative imports with explicit `.ts` extensions. Workspace packages
export their `src/*.ts` entry points; Node resolves the pnpm symlinks to the real path, so the
files are not treated as `node_modules` code. Next.js transpiles the same packages through
`transpilePackages`.

**TypeScript 6.0, not 7.0.** TypeScript 7 (the native port) is available, but
`typescript-eslint` supports `<6.1` only. We stay on 6.0 until type-aware linting supports 7.

**ESLint 10 without `eslint-config-next`.** `eslint-config-next` pulls `eslint-plugin-react`,
which does not support ESLint 10 yet (ESLint 9 is out of support). We use
`@next/eslint-plugin-next` and `eslint-plugin-react-hooks` directly with `typescript-eslint`'s
type-checked rules.

**Own rate limiter instead of `hono-rate-limiter`.** A fixed-window limiter is about 40 lines
(`apps/api/src/middleware/rate-limit.ts`) behind a `RateLimitStore` interface, so the planned
dependency was not needed. Better Auth's built-in limiter covers the auth routes.

**API paths are `/api/v1/*` inside the API too.** Better Auth builds URLs from its base URL and
matches routes on the request path; serving the API under the same prefix the browser uses
(single origin, ADR-0004) keeps both identical and the Next.js rewrite a plain pass-through.
The public contract (`/api/v1/...`) is unchanged.

**Client IP and proxies.** The Next.js rewrite forwards a client-supplied `X-Forwarded-For`
unchanged and does not append the client address, so it is not a trusted hop. The API trusts
`X-Forwarded-For` only for `TRUSTED_PROXY_HOPS` proxies that append to it: `0` locally (all
traffic shares the web container's address), `1` in production behind nginx, Caddy or
Traefik, which TLS termination requires anyway.

## Consequences

- No compile step for the API; Docker images copy sources and run them.
- Some TypeScript syntax is unavailable; lint and typecheck enforce it.
- Revisit TypeScript 7 and `eslint-config-next` when their ecosystems catch up (Dependabot).
- Production deployments must set `TRUSTED_PROXY_HOPS` correctly, documented in
  `.env.example` and the deployment guide (Phase 5).
