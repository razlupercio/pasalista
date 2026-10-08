// SPDX-License-Identifier: AGPL-3.0-or-later
import createClient, { type ClientOptions } from "openapi-fetch";
import type { paths } from "./schema.d.ts";

export type { components, paths } from "./schema.d.ts";

/**
 * Typed client for the PasaLista API, generated from apps/api/openapi.json.
 * Web: `baseUrl` is the site origin (same-origin `/api/*`). Mobile: the public API origin.
 */
export function createApiClient(options: ClientOptions = {}) {
  return createClient<paths>({ credentials: "include", ...options });
}

export type ApiClient = ReturnType<typeof createApiClient>;
