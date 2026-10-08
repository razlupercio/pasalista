// SPDX-License-Identifier: AGPL-3.0-or-later
import { createApiClient } from "@pasalista/api-client";
import { headers } from "next/headers";

const apiInternalUrl = process.env.API_INTERNAL_URL ?? "http://localhost:3001";

/**
 * Typed API client for Server Components. Forwards only the session cookie and the client
 * address chain (so per-IP rate limits apply to the real visitor behind a reverse proxy).
 */
export async function serverApi() {
  const incoming = await headers();
  const forwarded: Record<string, string> = {};
  const cookie = incoming.get("cookie");
  const forwardedFor = incoming.get("x-forwarded-for");
  if (cookie) forwarded.cookie = cookie;
  if (forwardedFor) forwarded["x-forwarded-for"] = forwardedFor;
  return createApiClient({ baseUrl: apiInternalUrl, headers: forwarded, cache: "no-store" });
}

/** Absolute origin of the current request, for links shown to organizers. */
export async function requestOrigin(): Promise<string> {
  const incoming = await headers();
  const host = incoming.get("x-forwarded-host") ?? incoming.get("host") ?? "localhost:3000";
  const proto =
    incoming.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
