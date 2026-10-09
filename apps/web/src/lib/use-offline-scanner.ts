// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import {
  evaluateOfflineManual,
  evaluateOfflineScan,
  MAX_SYNC_ITEMS,
  type OfflineBundle,
  type OfflineScan,
} from "@pasalista/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { browserApi } from "./api-browser.ts";
import {
  checkedInHere,
  enqueue,
  forgetEvent,
  loadBundle,
  markCheckedIn,
  purgeExpired,
  queued,
  removeQueued,
  saveBundle,
} from "./offline-store.ts";
import { deviceId } from "./scan-feedback.ts";

const BUNDLE_REFRESH_MS = 2 * 60 * 1000;
const SYNC_INTERVAL_MS = 10 * 1000;

export interface SyncSummary {
  duplicates: number;
  rejected: number;
}

/** Registers the service worker and hands it the assets this page already loaded. */
async function registerServiceWorker(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("/sw.js");
    const registration = await navigator.serviceWorker.ready;
    const urls = [
      location.href,
      ...performance.getEntriesByType("resource").map((entry) => entry.name),
    ];
    registration.active?.postMessage({ type: "cache-urls", urls });
  } catch {
    // Without a service worker the scanner still works offline until the page is reloaded.
  }
}

/**
 * Offline support for the scanner (ADR-0005): keeps the event bundle fresh, evaluates scans
 * locally when the network is gone, queues them and syncs when it is back.
 */
export function useOfflineScanner(
  eventId: string,
  /** State setter for the scanner counter (stable across renders). */
  setCounts: (counts: { checkedIn: number; registered: number }) => void,
) {
  const [bundle, setBundle] = useState<OfflineBundle | null>(null);
  const [online, setOnline] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [summary, setSummary] = useState<SyncSummary | null>(null);
  const syncing = useRef(false);

  const refreshPending = useCallback(async () => {
    setPendingCount((await queued(eventId)).length);
  }, [eventId]);

  const refreshBundle = useCallback(async () => {
    try {
      const { data, response } = await browserApi.GET("/api/v1/events/{eventId}/offline-bundle", {
        params: { path: { eventId } },
        signal: AbortSignal.timeout(10_000),
      });
      if (data) {
        await saveBundle(data);
        setBundle(data);
      } else if (response.status === 404) {
        // Access removed or event gone: nothing about it stays on the device.
        await forgetEvent(eventId);
        setBundle(null);
      }
    } catch {
      setOnline(false);
    }
  }, [eventId]);

  const sync = useCallback(async () => {
    if (syncing.current) return;
    const pending = (await queued(eventId)).slice(0, MAX_SYNC_ITEMS);
    if (pending.length === 0) return;
    syncing.current = true;
    try {
      const { data } = await browserApi.POST("/api/v1/events/{eventId}/check-ins/sync", {
        params: { path: { eventId } },
        body: { deviceId: deviceId(), items: pending.map((entry) => entry.item) },
        signal: AbortSignal.timeout(20_000),
      });
      if (!data) return;
      setOnline(true);
      await removeQueued(data.results.map((r) => r.clientCheckInId));
      const duplicates = data.results.filter((r) => r.status === "duplicate").length;
      const rejected = data.results.filter((r) => r.status === "rejected").length;
      if (duplicates || rejected) setSummary({ duplicates, rejected });
      setCounts(data.counts);
    } catch {
      setOnline(false);
    } finally {
      syncing.current = false;
      await refreshPending();
    }
  }, [eventId, refreshPending, setCounts]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await purgeExpired();
      const stored = await loadBundle(eventId);
      if (!cancelled && stored) setBundle(stored);
      await refreshPending();
      if (navigator.onLine) {
        await refreshBundle();
        await sync();
      } else if (!cancelled) {
        setOnline(false);
      }
      await registerServiceWorker();
    })();

    const goOnline = () => {
      setOnline(true);
      void sync().then(refreshBundle);
    };
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    const syncTimer = setInterval(() => void sync(), SYNC_INTERVAL_MS);
    const bundleTimer = setInterval(() => {
      if (navigator.onLine) void refreshBundle();
    }, BUNDLE_REFRESH_MS);
    return () => {
      cancelled = true;
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      clearInterval(syncTimer);
      clearInterval(bundleTimer);
    };
  }, [eventId, refreshBundle, refreshPending, sync]);

  /** Evaluates a scan without network and queues it when valid. */
  const checkInOffline = useCallback(
    async (
      credential: { method: "qr"; token: string } | { method: "manual"; attendeeId: string },
    ) => {
      if (!bundle) return null;
      const now = new Date();
      const already = await checkedInHere(eventId);
      const scan: OfflineScan =
        credential.method === "qr"
          ? evaluateOfflineScan(bundle, credential.token, already, now)
          : evaluateOfflineManual(bundle, credential.attendeeId, already, now);
      if (scan.outcome === "valid" && scan.attendee) {
        const clientCheckInId = crypto.randomUUID();
        await enqueue({
          eventId,
          attendeeId: scan.attendee.id,
          item:
            credential.method === "qr"
              ? {
                  method: "qr",
                  token: credential.token,
                  clientCheckInId,
                  scannedAt: now.toISOString(),
                }
              : {
                  method: "manual",
                  attendeeId: credential.attendeeId,
                  clientCheckInId,
                  scannedAt: now.toISOString(),
                },
        });
        await refreshPending();
      }
      return scan;
    },
    [bundle, eventId, refreshPending],
  );

  /** Remembers online check-ins too, so a later offline scan of the same ticket is caught. */
  const rememberCheckIn = useCallback(
    (attendeeId: string) => markCheckedIn(eventId, attendeeId),
    [eventId],
  );

  return {
    bundle,
    online,
    setOnline,
    pendingCount,
    summary,
    dismissSummary: () => setSummary(null),
    sync,
    checkInOffline,
    rememberCheckIn,
  };
}
