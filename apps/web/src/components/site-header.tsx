// SPDX-License-Identifier: AGPL-3.0-or-later
import { getTranslations } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button.tsx";
import { Link } from "@/i18n/navigation.ts";
import { getSession } from "@/lib/session.ts";
import { cn } from "@/lib/utils.ts";
import { LocaleSwitcher } from "./locale-switcher.tsx";
import { SignOutButton } from "./sign-out-button.tsx";
import { ThemeSwitcher } from "./theme-switcher.tsx";

/** Header buttons stay compact so the page content (e.g. a ticket QR) fits on small screens. */
const compact = "min-h-9 px-3";

export async function SiteHeader() {
  const [t, session] = await Promise.all([getTranslations(), getSession()]);

  return (
    <header className="border-b">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2">
        <Link href="/" className="text-lg font-semibold">
          {t("common.appName")}
        </Link>
        <nav
          aria-label={t("common.appName")}
          className="ml-auto flex items-center gap-2 sm:order-last"
        >
          {session ? (
            <>
              <Link href="/dashboard" className={cn(buttonVariants({ variant: "ghost" }), compact)}>
                {t("nav.dashboard")}
              </Link>
              <SignOutButton className={compact} />
            </>
          ) : (
            <>
              <Link href="/sign-in" className={cn(buttonVariants({ variant: "ghost" }), compact)}>
                {t("nav.signIn")}
              </Link>
              <Link href="/sign-up" className={cn(buttonVariants(), compact)}>
                {t("nav.signUp")}
              </Link>
            </>
          )}
        </nav>
        <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
          <LocaleSwitcher />
          <ThemeSwitcher />
        </div>
      </div>
    </header>
  );
}
