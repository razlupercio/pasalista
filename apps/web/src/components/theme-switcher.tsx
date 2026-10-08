// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useHydrated } from "@/lib/use-hydrated.ts";
import { selectClass } from "./locale-switcher.tsx";

const themes = ["system", "light", "dark"] as const;

export function ThemeSwitcher() {
  const t = useTranslations("common.theme");
  const { theme, setTheme } = useTheme();
  // The stored theme is only known on the client; render a stable value during SSR.
  const hydrated = useHydrated();

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="sr-only">{t("label")}</span>
      <select
        className={selectClass}
        value={hydrated ? (theme ?? "system") : "system"}
        onChange={(event) => setTheme(event.target.value)}
      >
        {themes.map((value) => (
          <option key={value} value={value}>
            {t(value)}
          </option>
        ))}
      </select>
    </label>
  );
}
