// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CardTitle } from "@/components/ui/card.tsx";
import { Link, redirect } from "@/i18n/navigation.ts";
import { toLocale } from "@/i18n/routing.ts";
import { serverApi } from "@/lib/api-server.ts";
import { timeZoneOptions } from "@/lib/dates.ts";
import { requireSession } from "@/lib/session.ts";
import { EventForm } from "../../event-form.tsx";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("events.form");
  return { title: t("editTitle") };
}

export default async function EditEventPage({
  params,
}: {
  params: Promise<{ locale: string; eventId: string }>;
}) {
  const { locale: rawLocale, eventId } = await params;
  const locale = toLocale(rawLocale);
  setRequestLocale(locale);
  await requireSession(locale);

  const api = await serverApi();
  const { data: event } = await api.GET("/api/v1/events/{eventId}", {
    params: { path: { eventId } },
  });
  if (!event) notFound();
  // Purged events are read-only (ADR-0011).
  if (event.purgedAt) return redirect({ href: `/events/${event.id}`, locale });
  const [t, tCommon] = await Promise.all([
    getTranslations("events.form"),
    getTranslations("common"),
  ]);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <Link href={`/events/${event.id}`} className="text-sm underline underline-offset-4">
        {tCommon("back")}
      </Link>
      <CardTitle>{t("editTitle")}</CardTitle>
      <EventForm event={event} timeZones={timeZoneOptions()} />
    </div>
  );
}
