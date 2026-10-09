// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { toLocale } from "@/i18n/routing.ts";
import { serverApi } from "@/lib/api-server.ts";
import { requireSession } from "@/lib/session.ts";
import { ScannerApp } from "./scanner-app.tsx";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("scanner");
  return { title: t("title"), robots: { index: false, follow: false } };
}

/** Evaluated per request on the server (the page is dynamic). */
function windowStateNow(window: { opensAt: string; closesAt: string }) {
  const now = Date.now();
  if (now < Date.parse(window.opensAt)) return "before";
  if (now > Date.parse(window.closesAt)) return "after";
  return "open";
}

export default async function ScanPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; eventId: string }>;
  searchParams: Promise<{ mode?: string }>;
}) {
  const [{ locale: rawLocale, eventId }, { mode }] = await Promise.all([params, searchParams]);
  const locale = toLocale(rawLocale);
  setRequestLocale(locale);
  await requireSession(locale, `/scan/${eventId}`);

  const api = await serverApi();
  const { data: context } = await api.GET("/api/v1/events/{eventId}/scan-context", {
    params: { path: { eventId } },
  });
  if (!context) notFound();

  return (
    <ScannerApp
      context={context}
      windowState={windowStateNow(context.window)}
      initialTab={mode === "search" ? "search" : "scan"}
    />
  );
}
