// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Locale } from "@pasalista/core";
import { headers } from "next/headers";
import { redirect } from "@/i18n/navigation.ts";

const apiInternalUrl = process.env.API_INTERNAL_URL ?? "http://localhost:3001";

export interface Session {
  user: { id: string; name: string; email: string; locale?: string };
  session: { id: string; activeOrganizationId?: string | null };
}

export type MemberRole = "owner" | "admin" | "member";

export interface Organization {
  id: string;
  name: string;
  slug: string;
  isPersonal?: boolean;
}

export interface FullOrganization extends Organization {
  members: {
    id: string;
    userId: string;
    role: MemberRole;
    user: { name: string; email: string };
  }[];
  invitations: { id: string; email: string; role: MemberRole; status: string; expiresAt: string }[];
}

/**
 * Calls Better Auth from the Next.js server, forwarding only the session cookie and the client
 * address chain (for per-IP rate limits behind a reverse proxy).
 */
export async function authGet<T>(path: string): Promise<T | null> {
  const incoming = await headers();
  const cookie = incoming.get("cookie");
  const forwardedFor = incoming.get("x-forwarded-for");
  if (!cookie) return null;
  const response = await fetch(`${apiInternalUrl}/api/v1/auth${path}`, {
    headers: { cookie, ...(forwardedFor ? { "x-forwarded-for": forwardedFor } : {}) },
    cache: "no-store",
  });
  if (!response.ok) return null;
  return (await response.json()) as T | null;
}

export function getSession(): Promise<Session | null> {
  return authGet<Session>("/get-session");
}

export function getActiveOrganization(): Promise<FullOrganization | null> {
  return authGet<FullOrganization>("/organization/get-full-organization");
}

export async function listOrganizations(): Promise<Organization[]> {
  return (await authGet<Organization[]>("/organization/list")) ?? [];
}

/** For organizer pages: the session, or a redirect to sign in (keeps the locale). */
export async function requireSession(locale: Locale, next?: string): Promise<Session> {
  const session = await getSession();
  if (!session) {
    const href = next ? `/sign-in?next=${encodeURIComponent(next)}` : "/sign-in";
    return redirect({ href, locale });
  }
  return session;
}
