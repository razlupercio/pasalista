## Summary

<!-- What does this change and why? Link the issue it closes, if any. -->

## Checklist

- [ ] `pnpm lint && pnpm typecheck && pnpm test` pass locally
- [ ] New source files have the `SPDX-License-Identifier: AGPL-3.0-or-later` header
- [ ] User-facing text goes through i18n (es-MX and en), no hardcoded strings
- [ ] Inputs are validated with Zod schemas from `packages/core`
- [ ] No tokens, keys or personal data are logged
- [ ] Tests cover new behavior (required for tokens, check-in, authorization and offline sync)
- [ ] Significant decisions are recorded as an ADR in `docs/adr/`
- [ ] New dependencies are justified (license compatible with AGPL-3.0, maintenance, size)
