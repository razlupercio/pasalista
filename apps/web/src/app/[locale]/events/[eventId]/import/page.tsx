// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CardTitle } from "@/components/ui/card.tsx";
import { Link } from "@/i18n/navigation.ts";
import { toLocale } from "@/i18n/routing.ts";
import { serverApi } from "@/lib/api-server.ts";
import { requireSession } from "@/lib/session.ts";
import { ImportGuests } from "./import-guests.tsx";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("events.import");
  return { title: t("title") };
}

export default async function ImportPage({
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
  const t = await getTranslations("events.import");

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <Link href={`/events/${event.id}`} className="text-sm underline underline-offset-4">
        {t("backToEvent")}
      </Link>
      <div className="flex flex-col gap-1">
        <CardTitle>{t("title")}</CardTitle>
        <p className="text-muted-foreground">{event.name}</p>
      </div>
      <ImportGuests eventId={event.id} />
    </div>
  );
}
