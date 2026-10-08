// SPDX-License-Identifier: AGPL-3.0-or-later
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

/** Where the Next.js server reaches the API. Baked into the build (rewrites are static). */
const apiInternalUrl = process.env.API_INTERNAL_URL ?? "http://localhost:3001";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // Script/style CSP with nonces arrives in Phase 5 (ROADMAP.md); these directives are safe now.
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'",
  },
];

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)),
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ["@pasalista/core", "@pasalista/i18n", "@pasalista/api-client"],
  rewrites() {
    // Single origin (ADR-0004): the browser only ever talks to this server.
    return Promise.resolve([
      { source: "/api/:path*", destination: `${apiInternalUrl}/api/:path*` },
    ]);
  },
  headers() {
    return Promise.resolve([
      { source: "/:path*", headers: securityHeaders },
      // Pages that receive one-time tokens in the URL must never leak them via Referer.
      {
        source: "/:locale/reset-password",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
      {
        source: "/:locale/t/:token",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
    ]);
  },
};

export default createNextIntlPlugin("./src/i18n/request.ts")(nextConfig);
