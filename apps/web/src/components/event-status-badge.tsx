// SPDX-License-Identifier: AGPL-3.0-or-later
import type { EventStatus } from "@pasalista/core";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils.ts";

const tones: Record<EventStatus, string> = {
  draft: "border-input text-muted-foreground",
  published: "border-success/50 text-success",
  closed: "border-destructive/40 text-destructive",
};

export function EventStatusBadge({ status }: { status: EventStatus }) {
  const t = useTranslations("events.status");
  return (
    <span
      className={cn(
        "inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium",
        tones[status],
      )}
    >
      {t(status)}
    </span>
  );
}
