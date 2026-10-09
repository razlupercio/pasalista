// SPDX-License-Identifier: AGPL-3.0-or-later
import type { NextRequest } from "next/server";
import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing.ts";

const handleI18n = createMiddleware(routing);

/**
 * Content Security Policy with a per-request nonce (ADR-0012). Next.js reads the policy from the
 * request header and adds the nonce to its own scripts; the layout passes it to next-themes.
 */
export function contentSecurityPolicy(nonce: string, dev: boolean): string {
  return [
    "default-src 'self'",
    // 'wasm-unsafe-eval': the QR decoder is WebAssembly. 'unsafe-eval' only for dev tooling.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'${dev ? " 'unsafe-eval'" : ""}`,
    // React and Next.js emit style attributes; styles cannot run code.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    // Camera preview.
    "media-src 'self' blob: mediastream:",
    `connect-src 'self'${dev ? " ws:" : ""}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

export default function proxy(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const policy = contentSecurityPolicy(nonce, process.env.NODE_ENV === "development");
  request.headers.set("x-nonce", nonce);
  request.headers.set("Content-Security-Policy", policy);
  const response = handleI18n(request);
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export const config = {
  // Everything except the API rewrite, Next.js internals, generated icons and files with an extension.
  matcher: ["/((?!api|_next|_vercel|icon|apple-icon|.*\\..*).*)"],
};
