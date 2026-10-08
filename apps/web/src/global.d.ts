// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Locale } from "@pasalista/core";
import type { Messages } from "@pasalista/i18n";

declare module "next-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: Messages;
  }
}
