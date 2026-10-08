// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Messages } from "@pasalista/i18n";

export type AuthErrorKey = keyof Messages["auth"]["errors"];

/** Maps Better Auth error codes / HTTP statuses to i18n keys. Never show raw server messages. */
export function authErrorKey(
  error: { code?: string | undefined; status?: number } | null | undefined,
): AuthErrorKey {
  if (!error) return "generic";
  if (error.status === 429) return "rateLimited";
  switch (error.code) {
    case "INVALID_EMAIL_OR_PASSWORD":
      return "invalidCredentials";
    case "EMAIL_NOT_VERIFIED":
      return "emailNotVerified";
    case "INVALID_EMAIL":
      return "invalidEmail";
    case "PASSWORD_TOO_SHORT":
      return "passwordTooShort";
    case "PASSWORD_TOO_LONG":
      return "passwordTooLong";
    case "INVALID_TOKEN":
      return "linkInvalid";
    default:
      return "generic";
  }
}
