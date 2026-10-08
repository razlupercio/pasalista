// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import type { Event } from "@pasalista/core";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Alert } from "@/components/ui/alert.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { useRouter } from "@/i18n/navigation.ts";
import { apiErrorKey, browserApi, type ApiErrorKey } from "@/lib/api-browser.ts";
import { useHydrated } from "@/lib/use-hydrated.ts";

type Notice = { tone: "success" | "error"; text: string };

export function EventActions({ event, publicUrl }: { event: Event; publicUrl: string }) {
  const t = useTranslations("events.detail");
  const tApi = useTranslations("apiErrors");
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const path = { params: { path: { eventId: event.id } } };

  async function run(action: () => Promise<{ error?: unknown }>, success?: string) {
    setPending(true);
    setNotice(null);
    const result = await action();
    setPending(false);
    if (result.error) {
      const key: ApiErrorKey = apiErrorKey(result.error);
      setNotice({ tone: "error", text: tApi(key) });
      return false;
    }
    if (success) setNotice({ tone: "success", text: success });
    router.refresh();
    return true;
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setNotice({ tone: "success", text: t("copied") });
    } catch {
      // Clipboard access can be denied; the URL stays visible and selectable.
    }
  }

  const disabled = !hydrated || pending;

  return (
    <div className="flex flex-col gap-4">
      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}

      {event.status === "draft" ? (
        <p className="text-sm text-muted-foreground">{t("draftHint")}</p>
      ) : (
        <div className="flex flex-col gap-2">
          <Label htmlFor="public-url">{t("publicLink")}</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="public-url"
              readOnly
              value={publicUrl}
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button variant="outline" onClick={copyLink} disabled={!hydrated}>
              {t("copyLink")}
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        {event.status !== "published" ? (
          <Button
            disabled={disabled}
            onClick={() => run(() => browserApi.POST("/api/v1/events/{eventId}/publish", path))}
          >
            {event.status === "draft" ? t("publish") : t("reopen")}
          </Button>
        ) : (
          <Button
            variant="outline"
            disabled={disabled}
            onClick={() => run(() => browserApi.POST("/api/v1/events/{eventId}/close", path))}
          >
            {t("close")}
          </Button>
        )}
        {event.status === "draft" ? (
          <Button
            variant="outline"
            disabled={disabled}
            onClick={async () => {
              if (!window.confirm(t("deleteConfirm"))) return;
              if (await run(() => browserApi.DELETE("/api/v1/events/{eventId}", path)))
                router.replace("/dashboard");
            }}
          >
            {t("delete")}
          </Button>
        ) : null}
      </div>

      <details className="text-sm">
        <summary className="cursor-pointer font-medium">{t("security")}</summary>
        <div className="mt-3 flex flex-col items-start gap-2">
          <p className="text-muted-foreground">{t("rotateKeyHint")}</p>
          <Button
            variant="outline"
            disabled={disabled}
            onClick={async () => {
              setPending(true);
              const result = await browserApi.POST(
                "/api/v1/events/{eventId}/signing-keys/rotate",
                path,
              );
              setPending(false);
              setNotice(
                result.data
                  ? { tone: "success", text: t("rotateKeyDone", { version: result.data.version }) }
                  : { tone: "error", text: tApi(apiErrorKey(result.error)) },
              );
            }}
          >
            {t("rotateKey")}
          </Button>
        </div>
      </details>
    </div>
  );
}
