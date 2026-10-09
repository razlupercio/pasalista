// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import type { EventStats } from "@pasalista/core";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

const POLL_MS = 5_000;

/**
 * Dashboard numbers, refreshed by polling (ARCHITECTURE.md §10). Sends the last ETag so an
 * unchanged response is a cheap 304.
 */
export function LiveStats({
  eventId,
  initial,
  timeZone,
}: {
  eventId: string;
  initial: EventStats;
  timeZone: string;
}) {
  const t = useTranslations("events.stats");
  const format = useFormatter();
  const [stats, setStats] = useState(initial);
  const etag = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const response = await fetch(`/api/v1/events/${eventId}/stats`, {
          headers: etag.current ? { "If-None-Match": etag.current } : {},
          cache: "no-store",
        });
        if (cancelled || response.status !== 200) return;
        etag.current = response.headers.get("etag");
        setStats((await response.json()) as EventStats);
      } catch {
        // Keep showing the last numbers; the next poll retries.
      }
    };
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [eventId]);

  const tiles = [
    ["checkedIn", stats.checkedIn],
    ["registered", stats.registered],
    ["notCheckedIn", stats.notCheckedIn],
    ["pendingInvitations", stats.pendingInvitations],
    ["repeatedScans", stats.repeatedScans],
    ["rejectedScans", stats.rejectedScans],
  ] as const;

  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {tiles.map(([key, value]) => (
          <div key={key} className="rounded-lg border p-3">
            <dt className="text-sm text-muted-foreground">{t(key)}</dt>
            <dd className="text-2xl font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-col gap-2">
        <h3 className="font-medium">{t("recent")}</h3>
        {stats.recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noRecent")}</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm" aria-live="polite">
            {stats.recent.map((entry) => (
              <li
                key={entry.attendeeId}
                className="flex flex-wrap justify-between gap-2 border-b py-1 last:border-0"
              >
                <span>
                  {entry.name}
                  {entry.method === "manual" ? (
                    <span className="text-muted-foreground"> · {t("manual")}</span>
                  ) : null}
                </span>
                <span className="text-muted-foreground">
                  {format.dateTime(new Date(entry.checkedInAt), { timeStyle: "short", timeZone })}
                  {entry.scannedBy ? ` · ${t("by", { name: entry.scannedBy })}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {stats.offlineDuplicates.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-lg border border-amber-500/50 p-3">
          <h3 className="font-medium">{t("offlineDuplicates")}</h3>
          <p className="text-sm text-muted-foreground">{t("offlineDuplicatesHint")}</p>
          <ul className="flex flex-col gap-1 text-sm">
            {stats.offlineDuplicates.map((d) => (
              <li
                key={`${d.attendeeId}-${d.duplicateAt}`}
                className="flex flex-wrap justify-between gap-2"
              >
                <span>{d.name}</span>
                <span className="text-muted-foreground">
                  {t("kept", {
                    time: format.dateTime(new Date(d.keptAt), { timeStyle: "medium", timeZone }),
                  })}
                  {" · "}
                  {t("duplicate", {
                    time: format.dateTime(new Date(d.duplicateAt), {
                      timeStyle: "medium",
                      timeZone,
                    }),
                  })}
                  {d.scannedBy ? ` · ${t("by", { name: d.scannedBy })}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">{t("updated")}</p>
    </div>
  );
}
