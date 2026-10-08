// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { cache } from "react";
import { Alert } from "@/components/ui/alert.tsx";
import { Card, CardTitle } from "@/components/ui/card.tsx";
import { toLocale } from "@/i18n/routing.ts";
import { serverApi } from "@/lib/api-server.ts";
import { eventDateTimeOptions } from "@/lib/dates.ts";
import { RegistrationForm } from "./registration-form.tsx";

const loadEvent = cache(async (slug: string) => {
  const api = await serverApi();
  const { data } = await api.GET("/api/v1/public/events/{slug}", { params: { path: { slug } } });
  return data;
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const event = await loadEvent((await params).slug);
  return event ? { title: event.name, description: event.description ?? undefined } : {};
}

export default async function PublicEventPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale: rawLocale, slug } = await params;
  const locale = toLocale(rawLocale);
  setRequestLocale(locale);
  const event = await loadEvent(slug);
  if (!event) notFound();
  const [t, format] = await Promise.all([getTranslations("publicEvent"), getFormatter()]);
  const dateOptions = eventDateTimeOptions(event.timezone);

  return (
    <article className="mx-auto flex max-w-2xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">
          {t("organizedBy", { name: event.organizerName })}
        </p>
        <CardTitle className="text-3xl">{event.name}</CardTitle>
      </header>

      <dl className="grid gap-1 sm:grid-cols-[auto_1fr] sm:gap-x-4">
        <dt className="font-medium">{t("when")}</dt>
        <dd className="text-muted-foreground">
          {format.dateTime(new Date(event.startsAt), dateOptions)}
        </dd>
        <dt className="font-medium">{t("where")}</dt>
        <dd className="text-muted-foreground">
          {[event.venueName, event.venueAddress].filter(Boolean).join(", ")}
        </dd>
      </dl>

      {event.description ? <p className="whitespace-pre-line">{event.description}</p> : null}

      <Card className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">{t("registerTitle")}</h2>
        {event.registrationState === "open" ? (
          <>
            {event.registrationDeadline ? (
              <p className="text-sm text-muted-foreground">
                {t("deadline", {
                  date: format.dateTime(new Date(event.registrationDeadline), dateOptions),
                })}
              </p>
            ) : null}
            <RegistrationForm slug={event.slug} fields={event.registrationFields} />
          </>
        ) : (
          <Alert>{t(`states.${event.registrationState}`)}</Alert>
        )}
      </Card>
    </article>
  );
}
