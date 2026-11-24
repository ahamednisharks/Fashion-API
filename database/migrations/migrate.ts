import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { logger } from '../../src/common/utils/logger.js';
import { closeDatabase, pool } from '../../src/config/database.js';
import { env } from '../../src/config/env.js';
import { ensureInitialAdmin, initialAdminMessage } from '../initial-admin.js';
import { isMainModule, projectPath } from '../paths.js';

/** Arbitrary, project-specific key so concurrent runners wait for each other. */
const MIGRATION_LOCK_KEY = 7_270_001;
const FILE_PATTERN = /^(\d{3,})_[a-z0-9_-]+\.sql$/i;

export interface MigrationResult {
  readonly applied: string[];
  readonly upToDate: string[];
  /** True when the default admin login was created (empty users table). */
  adminCreated: boolean;
}

function checksum(sql: string): string {
  // Normalise line endings so Git's autocrlf setting doesn't change the checksum.
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex');
}

/**
 * Applies pending `database/migrations/NNN_name.sql` files in order.
 * Each file runs in its own transaction and is recorded in `schema_migrations`.
 * Already-applied files must not be edited (checksum mismatch aborts the run).
 * Afterwards, a new installation gets the default admin login (see ../initial-admin.ts).
 */
export async function runMigrations(): Promise<MigrationResult> {
  const dir = projectPath('database', 'migrations');
  const files = (await readdir(dir)).filter((file) => FILE_PATTERN.test(file)).sort();
  const result: MigrationResult = { applied: [], upToDate: [], adminCreated: false };

  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    text        PRIMARY KEY,
        name       text        NOT NULL,
        checksum   text        NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
    const { rows } = await client.query<{ version: string; checksum: string }>(
      'SELECT version, checksum FROM schema_migrations',
    );
    const applied = new Map(rows.map((row) => [row.version, row.checksum]));

    for (const file of files) {
      const version = FILE_PATTERN.exec(file)?.[1] ?? file;
      const sql = await readFile(path.join(dir, file), 'utf8');
      const sum = checksum(sql);
      const recorded = applied.get(version);

      if (recorded) {
        if (recorded !== sum) {
          throw new Error(
            `Migration ${file} has changed since it was applied. Create a new migration instead of editing an applied one.`,
          );
        }
        result.upToDate.push(file);
        continue;
      }

      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)',
          [version, file, sum],
        );
        await client.query('COMMIT');
        result.applied.push(file);
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`Migration ${file} failed and was rolled back: ${reason}`, {
          cause: error,
        });
      }
    }

    // Still under the advisory lock, so concurrent runners cannot both create the admin.
    result.adminCreated = await ensureInitialAdmin(client);
  } finally {
    await client
      .query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY])
      .catch(() => undefined);
    client.release();
  }
  return result;
}

if (isMainModule(import.meta.url)) {
  runMigrations()
    .then(({ applied, upToDate, adminCreated }) => {
      logger.info(
        `Database "${env.db.database}": ${applied.length} migration(s) applied, ${upToDate.length} already up to date.`,
      );
      applied.forEach((file) => logger.info(`  applied ${file}`));
      if (adminCreated) {
        logger.info(initialAdminMessage());
      }
    })
    .catch((error: unknown) => {
      logger.error(error instanceof Error ? error.message : 'Migration failed', error);
      process.exitCode = 1;
    })
    .finally(() => closeDatabase());
}
