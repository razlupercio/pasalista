// SPDX-License-Identifier: AGPL-3.0-or-later
import { z } from "zod";
import { localeSchema } from "./locale.ts";

/** OWASP ASVS L1: at least 12 characters, allow long passphrases, no composition rules. */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

export const passwordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);

export const personNameSchema = z.string().trim().min(1).max(120);

export const signUpInputSchema = z.object({
  name: personNameSchema,
  email: emailSchema,
  password: passwordSchema,
  locale: localeSchema,
});
export type SignUpInput = z.infer<typeof signUpInputSchema>;

export const signInInputSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});
export type SignInInput = z.infer<typeof signInInputSchema>;

export const magicLinkInputSchema = z.object({ email: emailSchema });
export const forgotPasswordInputSchema = z.object({ email: emailSchema });
export const resetPasswordInputSchema = z.object({ password: passwordSchema });
