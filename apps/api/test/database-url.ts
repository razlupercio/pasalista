// SPDX-License-Identifier: AGPL-3.0-or-later

/** Separate database so tests never touch development data. */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://pasalista:pasalista@localhost:5432/pasalista_test";
