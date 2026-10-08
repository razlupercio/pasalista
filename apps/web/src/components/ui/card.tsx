// SPDX-License-Identifier: AGPL-3.0-or-later
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils.ts";

export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("rounded-lg border bg-card p-6 text-card-foreground shadow-sm", className)}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: ComponentProps<"h1">) {
  return <h1 className={cn("text-2xl font-semibold tracking-tight", className)} {...props} />;
}
