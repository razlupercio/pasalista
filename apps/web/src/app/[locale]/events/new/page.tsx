// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CardTitle } from "@/components/ui/card.tsx";
import { toLocale } from "@/i18n/routing.ts";
import { timeZoneOptions } from "@/lib/dates.ts";
import { requireSession } from "@/lib/session.ts";
import { EventForm } from "../event-form.tsx";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("events.form");
  return { title: t("createTitle") };
}

export default async function NewEventPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = toLocale((await params).locale);
  setRequestLocale(locale);
  await requireSession(locale);
  const t = await getTranslations("events.form");
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <CardTitle>{t("createTitle")}</CardTitle>
      <EventForm event={null} timeZones={timeZoneOptions()} />
    </div>
  );
}
