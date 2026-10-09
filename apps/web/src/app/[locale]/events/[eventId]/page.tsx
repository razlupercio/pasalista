// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { EventStatusBadge } from "@/components/event-status-badge.tsx";
import { buttonVariants } from "@/components/ui/button.tsx";
import { Card, CardTitle } from "@/components/ui/card.tsx";
import { Link } from "@/i18n/navigation.ts";
import { toLocale } from "@/i18n/routing.ts";
import { requestOrigin, serverApi } from "@/lib/api-server.ts";
import { eventDateTimeOptions } from "@/lib/dates.ts";
import { requireSession } from "@/lib/session.ts";
import { GuestList } from "./guest-list.tsx";
import { StaffPanel } from "./staff-panel.tsx";
import { EventActions } from "./event-actions.tsx";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ eventId: string }>;
}): Promise<Metadata> {
  const api = await serverApi();
  const { data } = await api.GET("/api/v1/events/{eventId}", {
    params: { path: { eventId: (await params).eventId } },
  });
  return { title: data?.name ?? "" };
}

export default async function EventPage({
  params,
}: {
  params: Promise<{ locale: string; eventId: string }>;
}) {
  const { locale: rawLocale, eventId } = await params;
  const locale = toLocale(rawLocale);
  setRequestLocale(locale);
  await requireSession(locale);

  const api = await serverApi();
  const path = { params: { path: { eventId } } };
  const [{ data: event }, { data: attendees }, { data: staff }] = await Promise.all([
    api.GET("/api/v1/events/{eventId}", path),
    api.GET("/api/v1/events/{eventId}/attendees", {
      params: { path: { eventId }, query: { limit: 50, offset: 0 } },
    }),
    api.GET("/api/v1/events/{eventId}/staff", path),
  ]);
  if (!event) notFound();

  const [t, tEvents, tCommon, format, origin] = await Promise.all([
    getTranslations("events.detail"),
    getTranslations("events"),
    getTranslations("common"),
    getFormatter(),
    requestOrigin(),
  ]);
  const publicUrl = `${origin}/${locale}/e/${event.slug}`;

  return (
    <div className="flex flex-col gap-6">
      <Link href="/dashboard" className="text-sm underline underline-offset-4">
        {tCommon("back")}
      </Link>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <CardTitle>{event.name}</CardTitle>
          <EventStatusBadge status={event.status} />
        </div>
        <dl className="grid gap-1 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-4">
          <dt className="font-medium">{t("when")}</dt>
          <dd className="text-muted-foreground">
            {format.dateTime(new Date(event.startsAt), eventDateTimeOptions(event.timezone))}
          </dd>
          <dt className="font-medium">{t("where")}</dt>
          <dd className="text-muted-foreground">
            {[event.venueName, event.venueAddress].filter(Boolean).join(", ")}
          </dd>
        </dl>
        <p className="text-sm">
          {event.capacity
            ? tEvents("registeredOfCapacity", {
                count: event.registeredCount,
                capacity: event.capacity,
              })
            : tEvents("registeredCount", { count: event.registeredCount })}
        </p>
        <div>
          <Link
            href={`/events/${event.id}/edit`}
            className={buttonVariants({ variant: "outline" })}
          >
            {t("edit")}
          </Link>
        </div>
      </div>

      <Card className="flex flex-col gap-4">
        <EventActions event={event} publicUrl={publicUrl} />
      </Card>

      <section aria-labelledby="attendees-heading" className="flex flex-col gap-3">
        <h2 id="attendees-heading" className="text-xl font-semibold">
          {tEvents("attendees.title")}
        </h2>
        <GuestList
          eventId={event.id}
          eventStatus={event.status}
          initial={attendees ?? { items: [], total: 0, pendingCount: 0 }}
        />
      </section>

      <section aria-labelledby="staff-heading" className="flex flex-col gap-3">
        <h2 id="staff-heading" className="text-xl font-semibold">
          {tEvents("staff.title")}
        </h2>
        <StaffPanel eventId={event.id} staff={staff ?? { members: [], invitations: [] }} />
      </section>
    </div>
  );
}
