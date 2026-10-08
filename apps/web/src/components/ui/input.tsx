// SPDX-License-Identifier: AGPL-3.0-or-later
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils.ts";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "flex min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-invalid:border-destructive disabled:opacity-60",
        className,
      )}
      {...props}
    />
  );
}
