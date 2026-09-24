import 'dotenv/config';
import pg from 'pg';

const email = String(process.env.ADMIN_EMAIL || process.argv[2] || '').trim().toLowerCase();

if (!email) {
  console.error('Usage: ADMIN_EMAIL=admin@example.com node scripts/bootstrap-admin.js');
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required.');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

try {
  const found = await pool.query(
    'select id, email, role, account_status from customers where lower(email)=lower($1) limit 1',
    [email]
  );

  if (!found.rows[0]) {
    throw new Error('No RideOn customer exists for this email. Create the Supabase/RideOn account first, then run this script again.');
  }

  const row = found.rows[0];

  await pool.query(
    "update customers set role='admin', account_status='active', updated_at=now() where id=$1",
    [row.id]
  );

  console.log(JSON.stringify({
    success: true,
    userId: String(row.id),
    email: row.email,
    previousRole: row.role,
    accountStatus: 'active',
    message: 'Admin role assigned. Sign out and sign back in so the server resolves the new role.'
  }, null, 2));
} finally {
  await pool.end();
}
