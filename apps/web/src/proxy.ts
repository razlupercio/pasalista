// SPDX-License-Identifier: AGPL-3.0-or-later
import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing.ts";

export default createMiddleware(routing);

export const config = {
  // Everything except the API rewrite, Next.js internals and files with an extension.
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
