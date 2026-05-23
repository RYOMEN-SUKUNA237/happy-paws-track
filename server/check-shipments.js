require('dotenv').config({ path: './server/.env' });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

pool.query(`
  SELECT id, tracking_id, status, progress, is_paused,
         departed_at, paused_at, total_paused_ms,
         estimated_delivery, route_duration, created_at, actual_delivery
  FROM shipments
  ORDER BY created_at DESC
  LIMIT 10
`).then(async r => {
  console.log('\n=== RECENT 10 SHIPMENTS ===\n');
  
  for (const s of r.rows) {
    const dep   = s.departed_at  ? new Date(s.departed_at).getTime()  : null;
    const pause = s.paused_at    ? new Date(s.paused_at).getTime()    : null;
    const est   = s.estimated_delivery
      ? new Date(String(s.estimated_delivery).includes('T') ? s.estimated_delivery : s.estimated_delivery+'T00:00:00Z').getTime()
      : null;
    const totalPausedMs = parseInt(s.total_paused_ms) || 0;

    // Compute what progress SHOULD have been at the exact moment of pausing
    let correctFrozenProgress = null;
    if (s.is_paused && dep && pause && est) {
      const totalDur    = est - dep;
      const activeAtPause = (pause - dep) - totalPausedMs;
      if (totalDur > 0) {
        correctFrozenProgress = Math.max(0, Math.min(100,
          Math.round((activeAtPause / totalDur) * 1000) / 10
        ));
      }
    }

    console.log(`${s.tracking_id.padEnd(18)} | status: ${String(s.status).padEnd(18)} | stored: ${String(parseFloat(s.progress).toFixed(1)).padStart(6)}% | paused: ${s.is_paused ? 'YES' : 'no '}`);
    if (s.is_paused) {
      console.log(`   departed_at    : ${s.departed_at || 'NULL'}`);
      console.log(`   paused_at      : ${s.paused_at || 'NULL'}`);
      console.log(`   total_paused_ms: ${totalPausedMs}`);
      console.log(`   estimated_del  : ${s.estimated_delivery || 'NULL'}`);
      console.log(`   route_duration : ${s.route_duration || 'NULL'} sec`);
      if (correctFrozenProgress !== null) {
        console.log(`   ✅ CORRECT frozen progress (at pause time): ${correctFrozenProgress}%`);
        const diff = Math.abs(correctFrozenProgress - parseFloat(s.progress));
        if (diff > 0.5) {
          console.log(`   ❌ MISMATCH — stored ${parseFloat(s.progress).toFixed(1)}% vs correct ${correctFrozenProgress}%`);
        } else {
          console.log(`   ✓  Matches stored value`);
        }
      }
    }
    console.log('');
  }
  
  pool.end();
}).catch(e => { console.error(e.message); pool.end(); });
