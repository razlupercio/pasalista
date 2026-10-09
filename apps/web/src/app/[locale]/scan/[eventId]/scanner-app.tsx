// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import type { CheckInResult, ScanContext, ScanSearchResult } from "@pasalista/core";
import { Scanner, setZXingModuleOverrides } from "@yudiel/react-qr-scanner";
import { useFormatter, useTranslations } from "next-intl";
import { useRef, useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { browserApi } from "@/lib/api-browser.ts";
import { deviceId, scanFeedback } from "@/lib/scan-feedback.ts";
import { cn, formText } from "@/lib/utils.ts";

// Load the QR decoder from our own origin (copied by scripts/copy-zxing.ts), never a CDN.
setZXingModuleOverrides({
  locateFile: (path: string, prefix: string) =>
    path.endsWith(".wasm") ? `/zxing/${path}` : prefix + path,
});

/** A check-in before the device adds its client id and device id. */
type Pending = { method: "qr"; token: string } | { method: "manual"; attendeeId: string };

const tones: Record<CheckInResult["outcome"], string> = {
  valid: "bg-green-700 text-white",
  already_used: "bg-amber-400 text-black",
  invalid: "bg-red-700 text-white",
  wrong_event: "bg-red-700 text-white",
  revoked: "bg-red-700 text-white",
  outside_window: "bg-red-700 text-white",
};

/** Same QR read again within this time is ignored (the camera keeps seeing it). */
const REPEAT_GUARD_MS = 4_000;

export function ScannerApp({
  context,
  windowState,
}: {
  context: ScanContext;
  /** Computed on the server at request time. */
  windowState: "before" | "open" | "after";
}) {
  const t = useTranslations("scanner");
  const format = useFormatter();
  const [tab, setTab] = useState<"scan" | "search">("scan");
  const [counts, setCounts] = useState(context.counts);
  const [result, setResult] = useState<CheckInResult | null>(null);
  const [failed, setFailed] = useState<{ request: Pending; clientCheckInId: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [cameraError, setCameraError] = useState(false);
  const [matches, setMatches] = useState<ScanSearchResult | null>(null);
  const lastScan = useRef<{ token: string; at: number } | null>(null);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const time = (iso: string) =>
    format.dateTime(new Date(iso), { timeStyle: "short", timeZone: context.event.timezone });
  const opensAt = Date.parse(context.window.opensAt);

  function dismiss() {
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    setResult(null);
  }

  async function submit(request: Pending, clientCheckInId: string = crypto.randomUUID()) {
    setBusy(true);
    setFailed(null);
    const { data } = await browserApi
      .POST("/api/v1/events/{eventId}/check-ins", {
        params: { path: { eventId: context.event.id } },
        body: { ...request, clientCheckInId, deviceId: deviceId() },
      })
      .catch(() => ({ data: undefined }));
    setBusy(false);
    if (!data) {
      // Retrying reuses the same client id, so a request that did reach the server is not doubled.
      setFailed({ request, clientCheckInId });
      return;
    }
    setCounts(data.counts);
    setResult(data);
    scanFeedback(data.outcome);
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    dismissTimer.current = setTimeout(
      () => setResult(null),
      data.outcome === "valid" ? 2_000 : 4_000,
    );
  }

  function onCode(token: string) {
    if (busy || result) return;
    const previous = lastScan.current;
    if (previous && previous.token === token && Date.now() - previous.at < REPEAT_GUARD_MS) return;
    lastScan.current = { token, at: Date.now() };
    void submit({ method: "qr", token });
  }

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const q = formText(new FormData(event.currentTarget), "q").trim();
    if (q.length < 2) return;
    const { data } = await browserApi.GET("/api/v1/events/{eventId}/scan-search", {
      params: { path: { eventId: context.event.id }, query: { q } },
    });
    setMatches(data ?? []);
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">{context.event.name}</h1>
        <p className="text-sm font-medium" aria-live="polite">
          {t("inside", counts)}
        </p>
      </header>

      {windowState === "before" ? (
        <Alert>
          {t("notOpenYet", {
            date: format.dateTime(new Date(opensAt), {
              dateStyle: "full",
              timeStyle: "short",
              timeZone: context.event.timezone,
            }),
          })}
        </Alert>
      ) : windowState === "after" ? (
        <Alert tone="error">{t("closed")}</Alert>
      ) : null}

      <div role="tablist" className="grid grid-cols-2 gap-2">
        {(["scan", "search"] as const).map((value) => (
          <Button
            key={value}
            role="tab"
            aria-selected={tab === value}
            variant={tab === value ? "default" : "outline"}
            onClick={() => setTab(value)}
          >
            {value === "scan" ? t("scanTab") : t("searchTab")}
          </Button>
        ))}
      </div>

      {failed ? (
        <Alert tone="error" className="flex items-center justify-between gap-3">
          <span>{t("offline")}</span>
          <Button
            variant="outline"
            className="min-h-9"
            onClick={() => submit(failed.request, failed.clientCheckInId)}
          >
            {t("retry")}
          </Button>
        </Alert>
      ) : null}

      {tab === "scan" ? (
        <div className="flex flex-col gap-2">
          {cameraError ? (
            <Alert tone="error">{t("cameraError")}</Alert>
          ) : (
            <div className="overflow-hidden rounded-lg border bg-black">
              <Scanner
                onScan={(codes) => {
                  const value = codes[0]?.rawValue;
                  if (value) onCode(value);
                }}
                onError={(error) => {
                  console.warn("scanner error", error);
                  setCameraError(true);
                }}
                formats={["qr_code"]}
                // Preferences only: the library defaults require the back camera and at least
                // 640x640, which fails on laptops and low-resolution webcams.
                constraints={{
                  facingMode: { ideal: "environment" },
                  width: { ideal: 1280 },
                  height: { ideal: 720 },
                }}
                paused={Boolean(result) || busy}
                sound={false}
                components={{ finder: true }}
              />
            </div>
          )}
          <p className="text-sm text-muted-foreground">{t("cameraHint")}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <form role="search" onSubmit={search} className="flex gap-2">
            <div className="flex flex-1 flex-col gap-2">
              <Label htmlFor="scan-q">{t("searchLabel")}</Label>
              <Input
                id="scan-q"
                name="q"
                type="search"
                minLength={2}
                autoComplete="off"
                aria-describedby="scan-q-hint"
              />
              <p id="scan-q-hint" className="text-xs text-muted-foreground">
                {t("searchHint")}
              </p>
            </div>
            <Button type="submit" className="mt-6">
              {t("searchSubmit")}
            </Button>
          </form>
          {matches?.length === 0 ? <p className="text-muted-foreground">{t("noMatches")}</p> : null}
          <ul className="flex flex-col gap-2">
            {matches?.map((match) => (
              <li
                key={match.id}
                className="flex items-center justify-between gap-3 rounded-md border p-3"
              >
                <span className="flex flex-col">
                  <span className="font-medium">{match.name}</span>
                  <span className="text-sm text-muted-foreground">{match.maskedEmail}</span>
                  {match.checkedInAt ? (
                    <span className="text-sm text-muted-foreground">
                      {t("alreadyInside", { time: time(match.checkedInAt) })}
                    </span>
                  ) : null}
                </span>
                {match.checkedInAt ? null : (
                  <Button
                    disabled={busy}
                    onClick={async () => {
                      await submit({ method: "manual", attendeeId: match.id });
                      setMatches(
                        (list) =>
                          list?.map((m) =>
                            m.id === match.id ? { ...m, checkedInAt: new Date().toISOString() } : m,
                          ) ?? null,
                      );
                    }}
                  >
                    {t("checkInButton")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {result ? (
        <button
          type="button"
          onClick={dismiss}
          aria-live="assertive"
          className={cn(
            "fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 p-6 text-center",
            tones[result.outcome],
          )}
        >
          <span className="text-4xl font-black tracking-tight sm:text-5xl">
            {t(`outcomes.${result.outcome}`)}
          </span>
          {result.attendee ? (
            <span className="text-2xl font-semibold">{result.attendee.name}</span>
          ) : null}
          {result.outcome === "already_used" && result.checkedInAt ? (
            <span className="text-lg">
              {t("details.already_used", { time: time(result.checkedInAt) })}
            </span>
          ) : result.outcome !== "valid" && result.outcome !== "already_used" ? (
            <span className="text-lg">{t(`details.${result.outcome}`)}</span>
          ) : null}
          <span className="text-sm opacity-80">{t("tapToContinue")}</span>
        </button>
      ) : null}
    </div>
  );
}
