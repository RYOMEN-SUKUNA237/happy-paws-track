require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { pool } = require('./db');

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('🔌 Connected to Supabase PostgreSQL');
    console.log('🏗️ Adding scheduled_transit_stops column to shipments table...');
    await client.query(`
      ALTER TABLE shipments 
      ADD COLUMN IF NOT EXISTS scheduled_transit_stops JSONB DEFAULT '[]';
    `);
    console.log('✅ Column scheduled_transit_stops successfully added!');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
