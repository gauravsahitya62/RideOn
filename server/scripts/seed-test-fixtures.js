import 'dotenv/config';
import pg from 'pg';

if (process.env.NODE_ENV !== 'test') throw new Error('Test fixtures can only be seeded when NODE_ENV=test.');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for PostgreSQL test fixtures.');

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
});

const vehicles = [
  ['creta-01','car','Hyundai Creta','Jaipur',249900,'Automatic','Petrol',5],
  ['baleno-01','car','Maruti Baleno','Jaipur',149900,'Manual','Petrol',5],
  ['classic-01','bike','Royal Enfield Classic 350','Jaipur',99900,null,null,2],
  ['activa-01','bike','Honda Activa 6G','Jaipur',49900,'Automatic','Petrol',2],
];

try {
  for (const [id,type,name,city,rate,transmission,fuel,seats] of vehicles) {
    await pool.query(
      `insert into vehicles (id,type,name,city,daily_rate_paise,active,transmission,fuel,seats)
       values ($1,$2,$3,$4,$5,true,$6,$7,$8)
       on conflict (id) do update set active=true,daily_rate_paise=excluded.daily_rate_paise,
         name=excluded.name,city=excluded.city,transmission=excluded.transmission,
         fuel=excluded.fuel,seats=excluded.seats`,
      [id,type,name,city,rate,transmission,fuel,seats]
    );
  }
  console.log('RideOn PostgreSQL test fixtures seeded.');
} finally {
  await pool.end();
}
