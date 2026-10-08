# Decisions log (pre-Phase 0)

Decisions agreed during initial ideation. Changing them requires explicit confirmation.
New technical decisions go as ADRs in `docs/adr/`.

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Name: **PasaLista** | "Pasar lista" (taking roll call) is literally what the app does; distinctive identity with a strong Spanish-speaking fit. |
| 2 | License: **AGPL-3.0** | Keeps the project free software while preventing closed hosted forks, and leaves room for donations, a commercial license and a hosted offering. |
| 3 | **Separate Hono API** (no business logic in Next.js) | The future mobile app will consume the same API; extracting logic later would be expensive. |
| 4 | TypeScript monorepo (pnpm + Turborepo) with shared `packages/core` | Reuse domain logic, validation and QR tokens across web, api and Expo. |
| 5 | PostgreSQL + Drizzle + Better Auth | Open source, no vendor lock-in, self-hostable with Docker Compose. |
| 6 | QR signed with **Ed25519** (per-event key) | Offline mode requires verifying without network; with HMAC the secret would have to live on the scanner phone. With asymmetric signatures the scanner only stores the public key. |
| 7 | **Offline mode is implemented** (Phase 4b), not just designed | Events often have poor connectivity. Phase 4 is split: 4a online, 4b offline. |
| 8 | PWA for the web scanner | Staff scan from the browser; the flow gets validated before the native app. |
| 9 | Multi-tenant from the data model | Cheap now, expensive later; enables a hosted offering. |
| 10 | Out of MVP: payments, ticket sales, multiple ticket types, wallet passes | v2 candidates. |
| 11 | One branch and one PR per phase; nothing directly to `main` | Small, reversible diffs. |

## Open items
- Check domain, GitHub/npm name and trademark availability for "PasaLista".
- Donation platform: GitHub Sponsors vs Open Collective.
- Contributor agreement (CLA or equivalent): needed if a commercial license is offered on
  top of AGPL code, so external contributions can be relicensed.
