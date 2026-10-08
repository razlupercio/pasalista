// SPDX-License-Identifier: AGPL-3.0-or-later
import { getTranslations } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button.tsx";
import { Link } from "@/i18n/navigation.ts";
import { getSession } from "@/lib/session.ts";
import { LocaleSwitcher } from "./locale-switcher.tsx";
import { SignOutButton } from "./sign-out-button.tsx";
import { ThemeSwitcher } from "./theme-switcher.tsx";

export async function SiteHeader() {
  const [t, session] = await Promise.all([getTranslations(), getSession()]);

  return (
    <header className="border-b">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <Link href="/" className="text-lg font-semibold">
          {t("common.appName")}
        </Link>
        <nav aria-label={t("common.appName")} className="flex flex-wrap items-center gap-2">
          <LocaleSwitcher />
          <ThemeSwitcher />
          {session ? (
            <>
              <Link href="/dashboard" className={buttonVariants({ variant: "ghost" })}>
                {t("nav.dashboard")}
              </Link>
              <SignOutButton />
            </>
          ) : (
            <>
              <Link href="/sign-in" className={buttonVariants({ variant: "ghost" })}>
                {t("nav.signIn")}
              </Link>
              <Link href="/sign-up" className={buttonVariants()}>
                {t("nav.signUp")}
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
