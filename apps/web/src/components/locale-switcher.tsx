// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { isLocale, locales } from "@pasalista/core";
import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";
import { usePathname, useRouter } from "@/i18n/navigation.ts";

const selectClass =
  "min-h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function LocaleSwitcher() {
  const t = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="sr-only">{t("language")}</span>
      <select
        className={selectClass}
        value={locale}
        disabled={pending}
        onChange={(event) => {
          const next = event.target.value;
          if (!isLocale(next)) return;
          startTransition(() => router.replace(pathname, { locale: next }));
        }}
      >
        {locales.map((value) => (
          <option key={value} value={value}>
            {t(`languages.${value}`)}
          </option>
        ))}
      </select>
    </label>
  );
}

export { selectClass };
