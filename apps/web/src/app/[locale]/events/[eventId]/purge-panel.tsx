// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import type { Event } from "@pasalista/core";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { useRouter } from "@/i18n/navigation.ts";
import { apiErrorKey, browserApi } from "@/lib/api-browser.ts";
import { useHydrated } from "@/lib/use-hydrated.ts";

/** Danger zone: irreversibly deletes the event's personal data (ADR-0011). */
export function PurgePanel({ event, reminderDue }: { event: Event; reminderDue: boolean }) {
  const t = useTranslations("events.purge");
  const tApi = useTranslations("apiErrors");
  const router = useRouter();
  const hydrated = useHydrated();
  const [confirmSlug, setConfirmSlug] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const result = await browserApi.POST("/api/v1/events/{eventId}/purge", {
      params: { path: { eventId: event.id } },
      body: { confirmSlug },
    });
    setPending(false);
    if (result.error) {
      setError(tApi(apiErrorKey(result.error)));
      return;
    }
    router.refresh();
  }

  return (
    <section
      aria-labelledby="purge-heading"
      className="flex flex-col gap-3 rounded-lg border border-destructive/50 p-4"
    >
      <h2 id="purge-heading" className="text-xl font-semibold">
        {t("title")}
      </h2>
      {reminderDue ? <Alert>{t("reminder")}</Alert> : null}
      <p className="text-sm text-muted-foreground">{t("hint")}</p>
      {event.status !== "closed" ? (
        <p className="text-sm">{t("closeFirst")}</p>
      ) : (
        <form onSubmit={submit} method="post" className="flex flex-col gap-3">
          {error ? <Alert tone="error">{error}</Alert> : null}
          <div className="flex flex-col gap-2">
            <Label htmlFor="purge-confirm">{t("confirmLabel", { slug: event.slug })}</Label>
            <Input
              id="purge-confirm"
              value={confirmSlug}
              onChange={(e) => setConfirmSlug(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <Button
            type="submit"
            variant="destructive"
            className="self-start"
            disabled={!hydrated || pending || confirmSlug !== event.slug}
          >
            {t("submit")}
          </Button>
        </form>
      )}
    </section>
  );
}
