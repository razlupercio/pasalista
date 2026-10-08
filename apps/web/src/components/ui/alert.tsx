// SPDX-License-Identifier: AGPL-3.0-or-later
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils.ts";

/** Status message announced to screen readers. `error` uses role="alert" (assertive). */
export function Alert({
  className,
  tone = "info",
  ...props
}: ComponentProps<"div"> & { tone?: "info" | "error" | "success" }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "rounded-md border px-4 py-3 text-sm",
        tone === "error" && "border-destructive/50 text-destructive",
        tone === "success" && "border-success/50 text-success",
        className,
      )}
      {...props}
    />
  );
}
