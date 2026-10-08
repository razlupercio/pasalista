// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Database } from "@pasalista/db";
import type { KeyEncryptionKey } from "../crypto/key-encryption.ts";

export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** Anything that can run queries: the pool or an open transaction. */
export type Executor = Database | Transaction;

export interface ServiceDeps {
  db: Database;
  kek: KeyEncryptionKey;
  /** Public web origin, used to build links in emails. */
  publicUrl: string;
  now?: () => Date;
}

export function nowOf(deps: ServiceDeps): Date {
  return deps.now ? deps.now() : new Date();
}
