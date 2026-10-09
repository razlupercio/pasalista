// SPDX-License-Identifier: AGPL-3.0-or-later
import { z } from "zod";

// Zod compiles faster validators with `new Function` when it can. Browsers with a strict Content
// Security Policy (ADR-0012) report that probe as a violation, and some mobile engines lack it,
// so core always validates without code generation. The cost is negligible for our payloads.
// Must run before any schema is constructed: index.ts imports this module first.
z.config({ jitless: true });
