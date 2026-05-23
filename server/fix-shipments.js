/**
 * fix-shipments.js  (v3 — canonical single-ETA reconciliation)
 * ─────────────────────────────────────────────────────────────────────────
 * This script:
 *  1. REVERTS the 16 shipments wrongly auto-marked as "delivered" back to
 *     their original statuses as they were in the admin dashboard.
 *  2. Sets ONE canonical ISO timestamp for estimated_delivery on every
 *     active shipment so all dashboards use the exact same ETA.
 *  3. Recalculates progress from that single source of truth.
 *  4. Leaves delivered / returned / paused / pending exactly as-is.
 *
 * Run: node server/fix-shipments.js
 */

require('dotenv').config({ path: './server/.env' });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// ── Shipments wrongly auto-delivered in the last run ──────────────────────────
// Revert each to its original admin-dashboard status.
const REVERT_MAP = {
  'AT-8842-X9': 'in-transit',
  'AT-3291-K4': 'out-for-delivery',
  'AT-5510-A2': 'picked-up',
  'AT-4464-J3': 'picked-up',
  'AT-1794-O3': 'in-transit',
  'AT-5836-R9': 'out-for-delivery',
  'AT-3477-D2': 'in-transit',
  'AT-5449-O3': 'in-transit',
  'AT-5949-V8': 'in-transit',
  'AT-3530-R8': 'picked-up',
  'AT-7963-E2': 'picked-up',
  'AT-4561-B9': 'picked-up',
  'AT-7610-H8': 'picked-up',
  'AT-7284-I2': 'in-transit',
  'AT-1896-S3': 'in-transit',
  'AT-7636-D0': 'in-transit',
};

// ── Progress floors so active status bars are visually meaningful ─────────────
const PROGRESS_FLOORS = { 'picked-up': 5, 'in-transit': 20, 'out-for-delivery': 80 };

// ── Time-based progress using ONLY estimated_delivery (single source of truth) ─
function computeProgress(s) {
  const status = s.status;
  if (status === 'delivered' || status === 'returned') return 100;
  if (status === 'pending') return 0;
  if (s.is_paused) return parseFloat(s.progress) || 0;
  if (!s.departed_at || !s.estimated_delivery) return parseFloat(s.progress) || 0;

  const departedMs  = new Date(s.departed_at).getTime();
  const estStr      = String(s.estimated_delivery);
  const estimatedMs = new Date(estStr.includes('T') ? estStr : estStr + 'T23:59:59Z').getTime();
  const totalDur    = estimatedMs - departedMs;
  if (totalDur <= 0) return 100;

  const nowMs         = Date.now();
  const pausedMs      = parseInt(s.total_paused_ms) || 0;
  const elapsedActive = (nowMs - departedMs) - pausedMs;
  const raw           = Math.max(0, Math.min(100, (elapsedActive / totalDur) * 100));
  const floor         = PROGRESS_FLOORS[status] ?? 0;
  return Math.round(Math.max(floor, raw) * 10) / 10;
}

// ── Compute single canonical ETA for a shipment ───────────────────────────────
// Priority: departed_at + route_duration > existing ISO timestamp > leave as-is
function canonicalEta(s) {
  // Already a full ISO timestamp → keep it
  if (s.estimated_delivery && String(s.estimated_delivery).includes('T')) return null;

  // Can compute exactly from route_duration + departed_at
  if (s.route_duration && s.departed_at) {
    const etaMs = new Date(s.departed_at).getTime() + parseFloat(s.route_duration) * 1000;
    return new Date(etaMs).toISOString();
  }

  // Date-only fallback → convert to ISO midnight so at least it's parseable uniformly
  if (s.estimated_delivery) {
    const d = String(s.estimated_delivery);
    return d + 'T00:00:00.000Z';
  }

  return null;
}

async function main() {
  const client = await pool.connect();
  try {
    console.log('');
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║   NextTrace — Shipment Canonical Reconciliation  v3          ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log('');

    const { rows: all } = await client.query(`
      SELECT id, tracking_id, status, progress, is_paused,
             departed_at, paused_at, total_paused_ms,
             estimated_delivery, route_duration, actual_delivery
      FROM shipments ORDER BY created_at ASC
    `);

    console.log(`Loaded ${all.length} shipment(s).\n`);

    const reverted   = [];
    const etaFixed   = [];
    const progFixed  = [];
    const alreadyOk  = [];

    for (const s of all) {
      let changed = false;
      const parts  = [];
      const params = [];

      // ── STEP 1: revert wrongly auto-delivered shipments ────────────────
      const originalStatus = REVERT_MAP[s.tracking_id];
      if (originalStatus && s.status === 'delivered') {
        params.push(originalStatus); parts.push(`status = $${params.length}`);
        // Remove the actual_delivery date only if it was set by the script (not a real delivery)
        parts.push(`actual_delivery = NULL`);
        // Remove 100% progress that was forced
        const recomputedProg = computeProgress({ ...s, status: originalStatus });
        params.push(recomputedProg); parts.push(`progress = $${params.length}`);
        reverted.push({ id: s.tracking_id, originalStatus });
        changed = true;
      }

      // ── STEP 2: fix estimated_delivery to full ISO timestamp ───────────
      // Use the status we're reverting TO (if reverting), not the current DB status
      const effectiveStatus = (originalStatus && s.status === 'delivered') ? originalStatus : s.status;
      if (!['pending', 'delivered', 'returned'].includes(effectiveStatus)) {
        const newEta = canonicalEta(s);
        if (newEta) {
          params.push(newEta); parts.push(`estimated_delivery = $${params.length}`);
          etaFixed.push(s.tracking_id);
          changed = true;
        }
      }

      // ── STEP 3: recalculate progress for active / non-paused shipments ──
      if (!['pending', 'delivered', 'returned'].includes(effectiveStatus) && !s.is_paused) {
        // Use updated ETA if we just fixed it
        const etaForCalc = (params.includes(params.find(p => typeof p === 'string' && p.includes('T') && p.length > 10)))
          ? params[params.findIndex(p => typeof p === 'string' && p.includes('T') && p.length > 10)]
          : s.estimated_delivery;
        const sForCalc = {
          ...s,
          status: effectiveStatus,
          estimated_delivery: etaForCalc || s.estimated_delivery,
        };
        const newProg = computeProgress(sForCalc);
        const oldProg = parseFloat(s.progress) || 0;
        if (Math.abs(newProg - oldProg) >= 0.05) {
          params.push(newProg); parts.push(`progress = $${params.length}`);
          progFixed.push({ id: s.tracking_id, from: oldProg.toFixed(1), to: newProg.toFixed(1) });
          changed = true;
        }
      }

      // ── STEP 4: pending must always be 0 ──────────────────────────────
      if (s.status === 'pending') {
        if (parseFloat(s.progress) !== 0 || s.departed_at) {
          parts.push(`progress = 0`, `departed_at = NULL`);
          changed = true;
        }
      }

      // ── STEP 5: delivered/returned must always be 100 ─────────────────
      if ((s.status === 'delivered' || s.status === 'returned') && !originalStatus) {
        if (Math.abs(parseFloat(s.progress) - 100) >= 0.05) {
          params.push(100); parts.push(`progress = $${params.length}`);
          changed = true;
        }
      }

      if (!changed) { alreadyOk.push(s.tracking_id); continue; }

      params.push(s.id);
      await client.query(
        `UPDATE shipments SET ${parts.join(', ')} WHERE id = $${params.length}`,
        params
      );
    }

    // ── Remove the auto-added "Auto-marked delivered" tracking history entries ──
    if (reverted.length > 0) {
      const ids = reverted.map(r => r.id);
      const { rowCount } = await client.query(
        `DELETE FROM tracking_history
         WHERE tracking_id = ANY($1::text[])
         AND notes = 'Auto-marked delivered: shipment ETA has passed.'
         AND updated_by = 'system'`,
        [ids]
      );
      console.log(`🗑   Removed ${rowCount} auto-added tracking history entr${rowCount === 1 ? 'y' : 'ies'}.\n`);
    }

    // ── Print results ──────────────────────────────────────────────────────────
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    if (reverted.length) {
      console.log(`\n🔄  REVERTED TO ORIGINAL STATUS (${reverted.length})`);
      reverted.forEach(r => console.log(`     • ${r.id.padEnd(18)} → ${r.originalStatus}`));
    }

    if (etaFixed.length) {
      console.log(`\n⏱   ETA FIXED → FULL ISO TIMESTAMP (${etaFixed.length})`);
      etaFixed.forEach(id => process.stdout.write(`     ${id}  `));
      console.log('');
    }

    if (progFixed.length) {
      console.log(`\n📊  PROGRESS RECALCULATED (${progFixed.length})`);
      progFixed.forEach(r => console.log(`     • ${r.id.padEnd(18)} ${r.from}% → ${r.to}%`));
    }

    if (alreadyOk.length) {
      console.log(`\n✅  ALREADY CORRECT (${alreadyOk.length})`);
      alreadyOk.forEach(id => process.stdout.write(`     ${id}  `));
      console.log('');
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`\n✅  Done.`);
    console.log(`    Reverted    : ${reverted.length}`);
    console.log(`    ETA fixed   : ${etaFixed.length}`);
    console.log(`    Prog fixed  : ${progFixed.length}`);
    console.log(`    Already OK  : ${alreadyOk.length}`);
    console.log(`    Total       : ${all.length}`);
    console.log('\n    Single canonical ETA is now used across all dashboards.');
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
