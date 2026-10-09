// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";

import type { CheckInOutcome } from "@pasalista/core";

let audio: AudioContext | null = null;

function tone(frequency: number, durationMs: number, startAt = 0) {
  try {
    audio ??= new AudioContext();
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.frequency.value = frequency;
    gain.gain.value = 0.15;
    oscillator.connect(gain).connect(audio.destination);
    const start = audio.currentTime + startAt / 1000;
    oscillator.start(start);
    oscillator.stop(start + durationMs / 1000);
  } catch {
    // Audio is a nice-to-have; some browsers block it until a user gesture.
  }
}

/** Distinct sound and vibration per result, so staff can keep their eyes on the queue. */
export function scanFeedback(outcome: CheckInOutcome): void {
  const ok = outcome === "valid";
  const warn = outcome === "already_used";
  if (ok) tone(880, 120);
  else if (warn) {
    tone(520, 150);
    tone(520, 150, 220);
  } else tone(220, 450);
  try {
    navigator.vibrate?.(ok ? 80 : warn ? [120, 80, 120] : [300, 100, 300]);
  } catch {
    // Vibration is unsupported on some devices (e.g. iOS Safari).
  }
}

const DEVICE_KEY = "pasalista.deviceId";

/** Stable per-browser id sent with check-ins (helps tell scanners apart; not personal data). */
export function deviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_KEY);
    if (existing) return existing;
    const created = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, created);
    return created;
  } catch {
    return "unknown";
  }
}
