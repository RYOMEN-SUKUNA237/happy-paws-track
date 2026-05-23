/**
 * fix-shipments.js  (v2 — full reconciliation)
 * ─────────────────────────────────────────────────────────────────────────
 * One-time migration that makes ALL shipment data consistent across every
 * dashboard (admin table, live map, tracking page, main site).
 *
 * Strategy:
 *  1. DELIVERED / RETURNED       → progress = 100, is_paused = false
 *  2. PENDING                    → progress = 0, is_paused = false, clear departed_at
 *  3. OVERDUE active shipments   → auto-mark as 'delivered' with progress = 100
 *     (status is picked-up/in-transit/out-for-delivery but ETA has already passed)
 *  4. PAUSED (overdue ETA)       → keep paused but fix progress to frozen value
 *  5. Active, not overdue        → recalculate time-based progress, fix ETA to ISO
 *
 * Run: node server/fix-shipments.js
 */

require('dotenv').config({ path: './server/.env' });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Active statuses that should be moving
const ACTIVE_STATUSES = ['picked-up', 'in-transit', 'out-for-delivery'];

function computeProgressForActive(s) {
  if (!s.departed_at || !s.estimated_delivery) return parseFloat(s.progress) || 0;

  const departedMs  = new Date(s.departed_at).getTime();
  const routeDurMs  = s.route_duration ? parseFloat(s.route_duration) * 1000 : 0;
  const estStr      = String(s.estimated_delivery);
  const estimatedMs = new Date(estStr.includes('T') ? estStr : estStr + 'T23:59:59Z').getTime();
  const totalDur    = routeDurMs > 0 ? routeDurMs : (estimatedMs - departedMs);

  if (totalDur <= 0) return 100;

  const nowMs         = Date.now();
  const pausedMs      = parseInt(s.total_paused_ms) || 0;
  const elapsedActive = (nowMs - departedMs) - pausedMs;
  const pct           = Math.max(0, Math.min(100, (elapsedActive / totalDur) * 100));
  return Math.round(pct * 10) / 10;
}

function isOverdue(s) {
  if (!s.estimated_delivery) return false;
  const estStr  = String(s.estimated_delivery);
  const estMs   = new Date(estStr.includes('T') ? estStr : estStr + 'T23:59:59Z').getTime();
  return estMs < Date.now();
}

function buildIsoEta(s) {
  // Already full ISO — no change
  if (s.estimated_delivery && String(s.estimated_delivery).includes('T')) return null;
  if (s.route_duration && s.departed_at) {
    const etaMs = new Date(s.departed_at).getTime() + parseFloat(s.route_duration) * 1000;
    return new Date(etaMs).toISOString();
  }
  return null;
}

async function main() {
  const client = await pool.connect();

  try {
    console.log('');
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║        NextTrace — Shipment Full Reconciliation v2           ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log('');

    const { rows: all } = await client.query(`
      SELECT id, tracking_id, status, progress, is_paused,
             departed_at, paused_at, total_paused_ms,
             estimated_delivery, route_duration, created_at
      FROM shipments
      ORDER BY created_at ASC
    `);

    console.log(`Loaded ${all.length} shipment(s).\n`);

    const results = { autoDelivered: [], fixed: [], alreadyOk: [] };

    for (const s of all) {
      const status = s.status;

      // ── 1. Already terminal: delivered / returned ──────────────────────
      if (status === 'delivered' || status === 'returned') {
        const prog = parseFloat(s.progress);
        if (Math.abs(prog - 100) < 0.1 && !s.is_paused) {
          results.alreadyOk.push(s.tracking_id);
          continue;
        }
        await client.query(
          'UPDATE shipments SET progress = 100, is_paused = FALSE WHERE id = $1',
          [s.id]
        );
        results.fixed.push({ id: s.tracking_id, status, note: 'progress → 100' });
        continue;
      }

      // ── 2. Pending ──────────────────────────────────────────────────────
      if (status === 'pending') {
        const prog = parseFloat(s.progress);
        if (prog === 0 && !s.is_paused && !s.departed_at) {
          results.alreadyOk.push(s.tracking_id);
          continue;
        }
        await client.query(
          'UPDATE shipments SET progress = 0, is_paused = FALSE, departed_at = NULL WHERE id = $1',
          [s.id]
        );
        results.fixed.push({ id: s.tracking_id, status, note: 'reset to 0%, cleared departed_at' });
        continue;
      }

      // ── 3. Active but OVERDUE → auto-deliver ────────────────────────────
      if (ACTIVE_STATUSES.includes(status) && isOverdue(s)) {
        const today = new Date().toISOString().split('T')[0];
        await client.query(`
          UPDATE shipments
          SET status = 'delivered',
              progress = 100,
              is_paused = FALSE,
              actual_delivery = COALESCE(actual_delivery, $1)
          WHERE id = $2
        `, [today, s.id]);

        // Add a tracking history note
        await client.query(`
          INSERT INTO tracking_history (shipment_id, tracking_id, status, notes, updated_by)
          VALUES ($1, $2, 'delivered', 'Auto-marked delivered: shipment ETA has passed.', 'system')
        `, [s.id, s.tracking_id]);

        results.autoDelivered.push({ id: s.tracking_id, was: status });
        continue;
      }

      // ── 4. Paused ────────────────────────────────────────────────────────
      if (status === 'paused' || s.is_paused) {
        // Fix ETA to ISO if possible
        const newEta = buildIsoEta(s);
        // Frozen progress should be whatever was captured at pause time
        const frozenProg = parseFloat(s.progress) || 0;
        const needsEtaFix = !!newEta;
        const needsIsPausedFix = !s.is_paused;

        if (!needsEtaFix && !needsIsPausedFix) {
          results.alreadyOk.push(s.tracking_id);
          continue;
        }

        const parts = [];
        const params = [];
        if (needsEtaFix) {
          params.push(newEta);
          parts.push(`estimated_delivery = $${params.length}`);
        }
        if (needsIsPausedFix) {
          parts.push('is_paused = TRUE');
        }
        params.push(s.id);
        await client.query(`UPDATE shipments SET ${parts.join(', ')} WHERE id = $${params.length}`, params);

        const notes = [];
        if (needsEtaFix) notes.push('ETA → ISO');
        if (needsIsPausedFix) notes.push('is_paused → TRUE');
        results.fixed.push({ id: s.tracking_id, status, note: notes.join(', ') });
        continue;
      }

      // ── 5. Active, not overdue — recalculate progress + fix ETA ──────────
      if (ACTIVE_STATUSES.includes(status)) {
        const newProg  = computeProgressForActive(s);
        const oldProg  = parseFloat(s.progress) || 0;
        const newEta   = buildIsoEta(s);

        const progChanged = Math.abs(newProg - oldProg) >= 0.05;
        const etaChanged  = !!newEta;

        if (!progChanged && !etaChanged) {
          results.alreadyOk.push(s.tracking_id);
          continue;
        }

        const parts = [];
        const params = [];
        if (progChanged) {
          params.push(newProg);
          parts.push(`progress = $${params.length}`);
        }
        if (etaChanged) {
          params.push(newEta);
          parts.push(`estimated_delivery = $${params.length}`);
        }
        params.push(s.id);
        await client.query(`UPDATE shipments SET ${parts.join(', ')} WHERE id = $${params.length}`, params);

        const notes = [];
        if (progChanged) notes.push(`progress ${oldProg.toFixed(1)}% → ${newProg.toFixed(1)}%`);
        if (etaChanged) notes.push('ETA → ISO');
        results.fixed.push({ id: s.tracking_id, status, note: notes.join(', ') });
        continue;
      }
    }

    // ── Print summary ─────────────────────────────────────────────────────
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    if (results.autoDelivered.length > 0) {
      console.log(`\n📦  AUTO-MARKED AS DELIVERED (${results.autoDelivered.length})`);
      console.log('    These had active statuses but their ETA already passed:');
      results.autoDelivered.forEach(r =>
        console.log(`     • ${r.id.padEnd(18)} (was: ${r.was})`)
      );
    }

    if (results.fixed.length > 0) {
      console.log(`\n🔧  DATA CORRECTED (${results.fixed.length})`);
      results.fixed.forEach(r =>
        console.log(`     • ${r.id.padEnd(18)} [${r.status.padEnd(18)}]  ${r.note}`)
      );
    }

    if (results.alreadyOk.length > 0) {
      console.log(`\n✅  ALREADY CORRECT (${results.alreadyOk.length})`);
      results.alreadyOk.forEach(id => process.stdout.write(`     ${id}  `));
      console.log('');
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`\n✅  Reconciliation complete.`);
    console.log(`    Auto-delivered : ${results.autoDelivered.length}`);
    console.log(`    Fixed          : ${results.fixed.length}`);
    console.log(`    Already OK     : ${results.alreadyOk.length}`);
    console.log(`    Total          : ${all.length}`);
    console.log('\n    All dashboards will now show consistent data.');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  } catch (err) {
    console.error('\n❌ Error:', err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
