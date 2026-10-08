// SPDX-License-Identifier: AGPL-3.0-or-later
import type { ComponentProps } from "react";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";

/** Labelled input with optional hint and error, wired with aria-describedby / aria-invalid. */
export function FormField({
  id,
  label,
  hint,
  error,
  ...inputProps
}: ComponentProps<"input"> & {
  id: string;
  label: string;
  hint?: string;
  error?: string | undefined;
}) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        {...inputProps}
      />
      {hint ? (
        <p id={`${id}-hint`} className="text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
