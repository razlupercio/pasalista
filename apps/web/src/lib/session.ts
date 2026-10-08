// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Locale } from "@pasalista/core";
import { headers } from "next/headers";
import { redirect } from "@/i18n/navigation.ts";

const apiInternalUrl = process.env.API_INTERNAL_URL ?? "http://localhost:3001";

export interface Session {
  user: { id: string; name: string; email: string; locale?: string };
  session: { id: string; activeOrganizationId?: string | null };
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
}

/** Calls the API from the Next.js server, forwarding only the session cookie. */
async function authGet<T>(path: string): Promise<T | null> {
  const cookie = (await headers()).get("cookie");
  if (!cookie) return null;
  const response = await fetch(`${apiInternalUrl}/api/v1/auth${path}`, {
    headers: { cookie },
    cache: "no-store",
  });
  if (!response.ok) return null;
  return (await response.json()) as T | null;
}

export function getSession(): Promise<Session | null> {
  return authGet<Session>("/get-session");
}

export function getActiveOrganization(): Promise<Organization | null> {
  return authGet<Organization>("/organization/get-full-organization");
}

/** For organizer pages: the session, or a redirect to sign in (keeps the locale). */
export async function requireSession(locale: Locale): Promise<Session> {
  const session = await getSession();
  if (!session) return redirect({ href: "/sign-in", locale });
  return session;
}
