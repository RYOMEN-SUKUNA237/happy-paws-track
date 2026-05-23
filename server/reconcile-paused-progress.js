require('dotenv').config({ path: './server/.env' });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  console.log('\n=== RECONCILING PAUSED SHIPMENT PROGRESS ===\n');

  try {
    // 1. Update AT-3227-I5
    console.log('Updating AT-3227-I5 (setting progress to 85.0%)...');
    await pool.query(`
      UPDATE shipments
      SET progress = 85.0
      WHERE tracking_id = 'AT-3227-I5'
    `);

    // 2. Update AT-3349-V0
    console.log('Updating AT-3349-V0 (setting progress to 50.0% and restoring paused_at)...');
    await pool.query(`
      UPDATE shipments
      SET progress = 50.0,
          paused_at = '2026-05-14T14:09:11.950Z'
      WHERE tracking_id = 'AT-3349-V0'
    `);

    // 3. Update AT-2090-W6
    console.log('Updating AT-2090-W6 (setting progress to 15.0%)...');
    await pool.query(`
      UPDATE shipments
      SET progress = 15.0
      WHERE tracking_id = 'AT-2090-W6'
    `);

    console.log('\n=== VERIFYING UPDATED SHIPMENTS ===\n');
    const { rows } = await pool.query(`
      SELECT tracking_id, status, progress, is_paused, departed_at, paused_at, total_paused_ms, estimated_delivery
      FROM shipments
      WHERE tracking_id IN ('AT-3227-I5', 'AT-3349-V0', 'AT-2090-W6')
    `);

    for (const r of rows) {
      console.log(`${r.tracking_id} | status: ${r.status} | progress: ${r.progress}% | is_paused: ${r.is_paused} | paused_at: ${r.paused_at}`);
    }

    console.log('\n✅ All paused shipments successfully reconciled!');

  } catch (e) {
    console.error('❌ Error during reconciliation:', e.message);
  } finally {
    await pool.end();
  }
}

main();
