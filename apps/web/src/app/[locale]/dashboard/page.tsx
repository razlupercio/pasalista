// SPDX-License-Identifier: AGPL-3.0-or-later
import { toLocale } from "@/i18n/routing.ts";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Card, CardTitle } from "@/components/ui/card.tsx";
import { redirect } from "@/i18n/navigation.ts";
import { getActiveOrganization, getSession } from "@/lib/session.ts";

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
  const [t, organization] = await Promise.all([
    getTranslations("dashboard"),
    getActiveOrganization(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <CardTitle>{t("greeting", { name: session.user.name })}</CardTitle>
        {organization ? (
          <p className="text-muted-foreground">{t("organization", { name: organization.name })}</p>
        ) : null}
      </div>
      <Card>
        <p className="text-muted-foreground">{t("emptyEvents")}</p>
      </Card>
    </div>
  );
}
