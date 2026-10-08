// SPDX-License-Identifier: AGPL-3.0-or-later
import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing.ts";

export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
