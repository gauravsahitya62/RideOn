import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Client } = pg;
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required to run database migrations.');
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, '../db/migrations');

const client = new Client({
  connectionString: databaseUrl,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
});

await client.connect();

try {
  await client.query('begin');
  await client.query(`
    create table if not exists schema_migrations (
      version varchar(255) primary key,
      applied_at timestamptz not null default now()
    )
  `);
  await client.query('commit');

  const files = (await fs.readdir(migrationsDir))
    .filter((file) => /^\\d+_.+\\.sql$/.test(file))
    .sort();

  for (const file of files) {
    const already = await client.query('select 1 from schema_migrations where version=$1', [file]);
    if (already.rows.length) continue;

    const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
    console.log(`Applying migration ${file}`);
    await client.query('begin');
    try {
      await client.query(sql);
      await client.query('insert into schema_migrations(version) values ($1)', [file]);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    }
  }

  console.log('RideOn database migrations are up to date.');
} finally {
  await client.end();
}
