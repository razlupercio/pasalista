// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CardTitle } from "@/components/ui/card.tsx";
import { Link } from "@/i18n/navigation.ts";
import { toLocale } from "@/i18n/routing.ts";
import { getActiveOrganization, requireSession } from "@/lib/session.ts";
import { TeamManager } from "./team-manager.tsx";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("team");
  return { title: t("title") };
}

export default async function TeamPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = toLocale((await params).locale);
  setRequestLocale(locale);
  const session = await requireSession(locale, "/team");
  const [t, tCommon, organization] = await Promise.all([
    getTranslations("team"),
    getTranslations("common"),
    getActiveOrganization(),
  ]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <Link href="/dashboard" className="text-sm underline underline-offset-4">
        {tCommon("back")}
      </Link>
      <CardTitle>{t("title")}</CardTitle>
      <TeamManager organization={organization} currentUserId={session.user.id} />
    </div>
  );
}
