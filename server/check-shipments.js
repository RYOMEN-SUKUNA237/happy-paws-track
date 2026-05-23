require('dotenv').config({ path: './server/.env' });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

pool.query(`
  SELECT tracking_id, status, progress, is_paused,
         departed_at, estimated_delivery, route_duration,
         created_at
  FROM shipments
  ORDER BY created_at DESC
  LIMIT 30
`).then(r => {
  const now = Date.now();
  console.log('\ntracking_id       | status              | progress | paused | est_delivery         | overdue?');
  console.log('------------------+---------------------+----------+--------+----------------------+---------');
  r.rows.forEach(s => {
    const prog   = parseFloat(s.progress).toFixed(1).padStart(6);
    const paused = s.is_paused ? 'YES' : 'no ';
    const est    = s.estimated_delivery ? String(s.estimated_delivery).substring(0, 19) : 'NULL               ';
    let overdue  = '';
    if (s.estimated_delivery && !['delivered','returned','pending'].includes(s.status)) {
      const estStr = String(s.estimated_delivery);
      const estMs  = new Date(estStr.includes('T') ? estStr : estStr + 'T23:59:59Z').getTime();
      overdue = estMs < now ? 'OVERDUE' : 'ok';
    }
    console.log(
      String(s.tracking_id).padEnd(18) + '| ' +
      String(s.status).padEnd(20) + '| ' +
      prog + '%  | ' +
      paused + '  | ' +
      est + ' | ' +
      overdue
    );
  });
  pool.end();
}).catch(e => { console.error(e.message); pool.end(); });
