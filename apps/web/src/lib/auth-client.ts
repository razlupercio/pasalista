// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import {
  inferAdditionalFields,
  magicLinkClient,
  organizationClient,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/** Browser auth client. Same origin: requests go to /api/v1/auth via the Next.js rewrite. */
export const authClient = createAuthClient({
  basePath: "/api/v1/auth",
  plugins: [
    inferAdditionalFields({ user: { locale: { type: "string", required: false } } }),
    magicLinkClient(),
    organizationClient(),
  ],
});
