// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Metadata } from "next";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { EventStatusBadge } from "@/components/event-status-badge.tsx";
import { buttonVariants } from "@/components/ui/button.tsx";
import { Card, CardTitle } from "@/components/ui/card.tsx";
import { Link, redirect } from "@/i18n/navigation.ts";
import { toLocale } from "@/i18n/routing.ts";
import { serverApi } from "@/lib/api-server.ts";
import { eventDateTimeOptions } from "@/lib/dates.ts";
import { cn } from "@/lib/utils.ts";
import { getActiveOrganization, getSession, listOrganizations } from "@/lib/session.ts";
import { OrganizationSwitcher } from "@/components/organization-switcher.tsx";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("dashboard");
  return { title: t("title") };
}

export default async function DashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const [{ locale: rawLocale }, { error }] = await Promise.all([params, searchParams]);
  const locale = toLocale(rawLocale);
  setRequestLocale(locale);

  const session = await getSession();
  if (!session) {
    // Failed email-verification or magic links land here with ?error=...
    return redirect({ href: error ? "/sign-in?error=link" : "/sign-in", locale });
  }
  const api = await serverApi();
  const [t, tEvents, format, organization, organizations, events, staffEvents] = await Promise.all([
    getTranslations("dashboard"),
    getTranslations("events"),
    getFormatter(),
    getActiveOrganization(),
    listOrganizations(),
    api.GET("/api/v1/events"),
    api.GET("/api/v1/me/staff-events"),
  ]);
  const list = events.data ?? [];
  const assigned = staffEvents.data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <CardTitle>{t("greeting", { name: session.user.name })}</CardTitle>
        {organization ? (
          <p className="text-muted-foreground">
            {t("organization", { name: organization.name })} ·{" "}
            <Link href="/team" className="underline underline-offset-4">
              {t("team")}
            </Link>
          </p>
        ) : null}
      </div>

      <OrganizationSwitcher
        organizations={organizations.map(({ id, name }) => ({ id, name }))}
        activeId={organization?.id ?? null}
      />

      <section aria-labelledby="events-heading" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="events-heading" className="text-xl font-semibold">
            {t("eventsTitle")}
          </h2>
          <Link href="/events/new" className={buttonVariants()}>
            {t("newEvent")}
          </Link>
        </div>

        {list.length === 0 ? (
          <Card>
            <p className="text-muted-foreground">{t("emptyEvents")}</p>
          </Card>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {list.map((event) => (
              <li key={event.id}>
                <Link
                  href={`/events/${event.id}`}
                  className="flex h-full flex-col gap-2 rounded-lg border bg-card p-4 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium">{event.name}</span>
                    <EventStatusBadge status={event.status} />
                  </div>
                  <span className="text-sm text-muted-foreground">
                    {format.dateTime(
                      new Date(event.startsAt),
                      eventDateTimeOptions(event.timezone),
                    )}
                  </span>
                  <span className="text-sm">
                    {event.capacity
                      ? tEvents("registeredOfCapacity", {
                          count: event.registeredCount,
                          capacity: event.capacity,
                        })
                      : tEvents("registeredCount", { count: event.registeredCount })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {assigned.length > 0 ? (
        <section aria-labelledby="staff-events-heading" className="flex flex-col gap-3">
          <h2 id="staff-events-heading" className="text-xl font-semibold">
            {t("staffEventsTitle")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("staffEventsHint")}</p>
          <ul className="grid gap-3 sm:grid-cols-2">
            {assigned.map((event) => (
              <li key={event.id} className="flex flex-col gap-1 rounded-lg border bg-card p-4">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium">{event.name}</span>
                  <EventStatusBadge status={event.status} />
                </div>
                <span className="text-sm text-muted-foreground">
                  {format.dateTime(new Date(event.startsAt), eventDateTimeOptions(event.timezone))}
                </span>
                <span className="text-sm text-muted-foreground">
                  {event.venueName} · {event.organizerName}
                </span>
                {event.status !== "draft" ? (
                  <Link
                    href={`/scan/${event.id}`}
                    className={cn(buttonVariants(), "mt-2 self-start")}
                  >
                    {t("scan")}
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
