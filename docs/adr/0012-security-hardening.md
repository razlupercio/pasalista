# ADR-0012: Content Security Policy and release hardening

- Status: Proposed
- Date: 2026-10-08

## Context

Phase 5 prepares the first release against OWASP ASVS level 1 (`docs/security/ASVS-L1.md`).
Until now the web app sent only a baseline CSP (`frame-ancestors`, `object-src`, `base-uri`,
`form-action`) because scripts and styles needed nonces.

## Decision

**Nonce-based CSP for every page.** `apps/web/src/proxy.ts` creates a random nonce per request
and sets the policy on both the request (Next.js reads it and adds the nonce to its scripts) and
the response. The root layout passes the nonce to next-themes for its pre-hydration script.
Reading the request headers makes pages render per request, which they already did for sessions.

```
default-src 'self'
script-src 'self' 'nonce-…' 'strict-dynamic' 'wasm-unsafe-eval'   ('unsafe-eval' in dev only)
style-src 'self' 'unsafe-inline'
img-src 'self' data: blob:
media-src 'self' blob: mediastream:
connect-src 'self'                                                ('ws:' in dev only)
worker-src 'self' blob:; manifest-src 'self'; font-src 'self'
frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'
```

- `'wasm-unsafe-eval'` is required by the self-hosted QR decoder (WebAssembly); it allows
  compiling WebAssembly only, not JavaScript `eval`.
- `style-src 'unsafe-inline'` stays: React and Next.js emit style attributes, and styles cannot
  run code. Script injection remains blocked by the nonce.
- Files with an extension, `_next` assets and the API keep the baseline policy from
  `next.config.ts` (the API sends its own `default-src 'none'`).

**Zod without code generation.** Zod 4 probes `new Function` to compile faster validators; under
this CSP the browser reports the probe as a violation. `packages/core` sets `jitless` before any
schema is built. The same setting suits React Native engines in the future mobile app; the
performance difference is negligible for our payload sizes.

**Breached-password check.** Better Auth's Have I Been Pwned plugin rejects passwords found in
breaches on sign-up, password change and reset. Only the first 5 hex characters of the password's
SHA-1 hash are sent (k-anonymity). Enabled by default; `PASSWORD_BREACH_CHECK=false` disables it
for air-gapped installs, and tests disable it. The check also runs for already registered emails,
so it does not reveal which emails have accounts.

**Automated checks.** An e2e test visits the main pages, fails on any CSP violation and runs axe
(WCAG 2.1 A and AA) in light and dark mode (`@axe-core/playwright`, MPL-2.0, dev only). CI runs
`pnpm audit --prod --audit-level high`.

## Consequences

- An injected `<script>` or inline event handler does not run, even if markup injection slips
  through React's escaping.
- New third-party scripts or origins need an explicit policy change, reviewed in this ADR.
- Sign-up and password changes depend on reaching `api.pwnedpasswords.com` unless disabled; if the
  service is unreachable the request fails with a generic error rather than skipping the check.
