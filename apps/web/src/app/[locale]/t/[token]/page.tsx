// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Alert } from "@/components/ui/alert.tsx";
import { Card, CardTitle } from "@/components/ui/card.tsx";
import { Link } from "@/i18n/navigation.ts";
import { toLocale } from "@/i18n/routing.ts";
import { serverApi } from "@/lib/api-server.ts";
import { eventDateTimeOptions } from "@/lib/dates.ts";
import { CancelRegistration } from "./cancel-registration.tsx";

// Secret link: keep it out of search engines (Referrer-Policy is set in next.config.ts).
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("ticket");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function TicketPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale: rawLocale, token } = await params;
  const locale = toLocale(rawLocale);
  setRequestLocale(locale);
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) notFound();

  const api = await serverApi();
  const { data: view } = await api.GET("/api/v1/public/tickets/{accessToken}", {
    params: { path: { accessToken: token } },
  });
  if (!view) notFound();
  const [t, tEvent, format] = await Promise.all([
    getTranslations("ticket"),
    getTranslations("publicEvent"),
    getFormatter(),
  ]);
  const qrSrc = `/api/v1/public/tickets/${token}/qr.png`;
  const valid = view.ticket.qrToken !== null;

  return (
    <article className="mx-auto flex max-w-md flex-col gap-5">
      <header className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">{t("holder", { name: view.attendee.name })}</p>
        <CardTitle>{view.event.name}</CardTitle>
      </header>

      <dl className="grid gap-1 text-sm">
        <dt className="font-medium">{tEvent("when")}</dt>
        <dd className="text-muted-foreground">
          {format.dateTime(
            new Date(view.event.startsAt),
            eventDateTimeOptions(view.event.timezone),
          )}
        </dd>
        <dt className="font-medium">{tEvent("where")}</dt>
        <dd className="text-muted-foreground">
          {[view.event.venueName, view.event.venueAddress].filter(Boolean).join(", ")}
        </dd>
      </dl>

      {valid ? (
        <Card className="flex flex-col items-center gap-4">
          {/* White background keeps the code scannable in dark mode. */}
          {/* eslint-disable-next-line @next/next/no-img-element -- dynamic, private, no-store image */}
          <img
            src={qrSrc}
            alt={t("qrAlt", { eventName: view.event.name })}
            width={288}
            height={288}
            className="rounded-md bg-white p-2"
          />
          <p className="text-center font-medium">{t("showAtEntrance")}</p>
          <a href={`${qrSrc}?download=1`} download className="text-sm underline underline-offset-4">
            {t("download")}
          </a>
        </Card>
      ) : (
        <Alert tone="error">
          {view.attendee.status === "cancelled" ? t("cancelled") : t("invalid")}
        </Alert>
      )}

      {valid ? <p className="text-sm text-muted-foreground">{t("addToHome")}</p> : null}

      <div className="flex flex-col items-start gap-3">
        <Link href={`/e/${view.event.slug}`} className="text-sm underline underline-offset-4">
          {t("eventPage")}
        </Link>
        {view.attendee.status === "active" ? <CancelRegistration token={token} /> : null}
      </div>
    </article>
  );
}
