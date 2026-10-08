// SPDX-License-Identifier: AGPL-3.0-or-later
import { toLocale } from "@/i18n/routing.ts";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button.tsx";
import { Link } from "@/i18n/navigation.ts";
import { getSession } from "@/lib/session.ts";

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = toLocale((await params).locale);
  setRequestLocale(locale);
  const [t, session] = await Promise.all([getTranslations("home"), getSession()]);

  return (
    <section className="flex flex-col items-start gap-6 py-12 sm:py-20">
      <h1 className="max-w-2xl text-4xl font-bold tracking-tight sm:text-5xl">{t("title")}</h1>
      <p className="max-w-xl text-lg text-muted-foreground">{t("subtitle")}</p>
      <div className="flex flex-wrap gap-3">
        {session ? (
          <Link href="/dashboard" className={buttonVariants()}>
            {t("goToDashboard")}
          </Link>
        ) : (
          <>
            <Link href="/sign-up" className={buttonVariants()}>
              {t("getStarted")}
            </Link>
            <Link href="/sign-in" className={buttonVariants({ variant: "outline" })}>
              {t("haveAccount")}
            </Link>
          </>
        )}
      </div>
    </section>
  );
}
