const express = require('express');
const { pool } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { generateTrackingId } = require('../utils/generators');
const { sendMail, buildShipmentCreationEmail, buildShipmentPauseEmail, buildShipmentStatusChangeEmail } = require('../utils/mailer');
let createTrackingUpdateDraft;
try {
  createTrackingUpdateDraft = require('./emails').createTrackingUpdateDraft;
} catch (e) {
  createTrackingUpdateDraft = null;
}

const router = express.Router();

// ─── TIME-BASED PROGRESS ────────────────────────────────────────────
function computeProgress(shipment) {
  // For delivered/returned, always 100
  if (shipment.status === 'delivered' || shipment.status === 'returned') return 100;
  // For pending, always 0
  if (shipment.status === 'pending') return 0;
  // ── Paused: return the frozen progress saved at pause-time ──
  // This guarantees the parcel does NOT move a single inch while paused.
  if (shipment.is_paused) {
    return parseFloat(shipment.progress) || 0;
  }
  // Need departed_at and estimated_delivery to compute
  if (!shipment.departed_at || !shipment.estimated_delivery) return shipment.progress || 0;

  const departedMs = new Date(shipment.departed_at).getTime();
  const estStr = String(shipment.estimated_delivery);
  const estimatedMs = new Date(estStr.includes('T') ? estStr : estStr + 'T23:59:59Z').getTime();
  const totalDuration = estimatedMs - departedMs;
  if (totalDuration <= 0) return shipment.progress || 0;

  const nowMs = Date.now();
  const pausedMs = parseInt(shipment.total_paused_ms) || 0;

  // If currently paused, don't count time since paused_at
  let currentPauseMs = 0;
  if (shipment.is_paused && shipment.paused_at) {
    currentPauseMs = nowMs - new Date(shipment.paused_at).getTime();
  }

  const elapsedActive = (nowMs - departedMs) - pausedMs - currentPauseMs;
  const progress = Math.max(0, Math.min(100, (elapsedActive / totalDuration) * 100));
  return Math.round(progress * 10) / 10; // 1 decimal
}

function enrichShipment(s) {
  s.computed_progress = computeProgress(s);
  return s;
}

// GET /api/shipments — List all shipments
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { status, courier_id, customer_id, search, page = 1, limit = 50 } = req.query;
    let query = 'SELECT * FROM shipments WHERE 1=1';
    let countQuery = 'SELECT COUNT(*) as total FROM shipments WHERE 1=1';
    const params = [];

    if (status && status !== 'all') {
      params.push(status);
      query += ` AND status = $${params.length}`;
      countQuery += ` AND status = $${params.length}`;
    }

    if (courier_id) {
      params.push(courier_id);
      query += ` AND courier_id = $${params.length}`;
      countQuery += ` AND courier_id = $${params.length}`;
    }

    if (customer_id) {
      params.push(customer_id);
      query += ` AND customer_id = $${params.length}`;
      countQuery += ` AND customer_id = $${params.length}`;
    }

    if (search) {
      const s = `%${search}%`;
      params.push(s, s, s, s, s);
      const n = params.length;
      query += ` AND (tracking_id ILIKE $${n-4} OR sender_name ILIKE $${n-3} OR receiver_name ILIKE $${n-2} OR origin ILIKE $${n-1} OR destination ILIKE $${n})`;
      countQuery += ` AND (tracking_id ILIKE $${n-4} OR sender_name ILIKE $${n-3} OR receiver_name ILIKE $${n-2} OR origin ILIKE $${n-1} OR destination ILIKE $${n})`;
    }

    const { rows: countRows } = await pool.query(countQuery, params);
    const total = parseInt(countRows[0].total);

    query += ' ORDER BY created_at DESC';
    const offset = (parseInt(page) - 1) * parseInt(limit);
    params.push(parseInt(limit), offset);
    query += ` LIMIT $${params.length - 1} OFFSET $${params.length}`;

    const { rows: shipments } = await pool.query(query, params);

    res.json({
      shipments: shipments.map(enrichShipment),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err) {
    console.error('List shipments error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// GET /api/shipments/:id/track — Public tracking endpoint (no auth required)
router.get('/:id/track', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT tracking_id, sender_name, receiver_name, origin, destination,
              origin_lat, origin_lng, dest_lat, dest_lng, current_lat, current_lng,
              status, progress, is_paused, estimated_delivery, actual_delivery,
              cargo_type, weight, route_data, transport_modes, route_distance,
              route_duration, route_summary, created_at,
              departed_at, paused_at, total_paused_ms,
              multi_modal_segments, multi_modal_stops
       FROM shipments WHERE tracking_id = $1`, [req.params.id]
    );

    const shipment = rows[0];
    if (!shipment) return res.status(404).json({ error: 'Shipment not found.' });

    // Parse JSON fields
    if (shipment.route_data && typeof shipment.route_data === 'string') {
      try { shipment.route_data = JSON.parse(shipment.route_data); } catch (e) {}
    }
    if (shipment.transport_modes && typeof shipment.transport_modes === 'string') {
      try { shipment.transport_modes = JSON.parse(shipment.transport_modes); } catch (e) {}
    }
    if (shipment.multi_modal_segments && typeof shipment.multi_modal_segments === 'string') {
      try { shipment.multi_modal_segments = JSON.parse(shipment.multi_modal_segments); } catch (e) {}
    }
    if (shipment.multi_modal_stops && typeof shipment.multi_modal_stops === 'string') {
      try { shipment.multi_modal_stops = JSON.parse(shipment.multi_modal_stops); } catch (e) {}
    }

    // Compute real-time progress
    enrichShipment(shipment);

    const { rows: history } = await pool.query(
      'SELECT status, location, lat, lng, notes, created_at FROM tracking_history WHERE tracking_id = $1 ORDER BY created_at DESC', [req.params.id]
    );

    // Get courier info (public-safe fields only)
    const { rows: fullRows } = await pool.query('SELECT courier_id FROM shipments WHERE tracking_id = $1', [req.params.id]);
    let courier = null;
    if (fullRows[0] && fullRows[0].courier_id) {
      const { rows: cRows } = await pool.query('SELECT courier_id, name, phone, vehicle_type, avatar, rating FROM couriers WHERE courier_id = $1', [fullRows[0].courier_id]);
      courier = cRows[0] || null;
    }

    res.json({ shipment, history, courier });
  } catch (err) {
    console.error('Track shipment error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// GET /api/shipments/:id — Get single shipment with tracking history
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM shipments WHERE id::text = $1 OR tracking_id = $1', [req.params.id]);
    const shipment = rows[0];
    if (!shipment) return res.status(404).json({ error: 'Shipment not found.' });

    const { rows: history } = await pool.query('SELECT * FROM tracking_history WHERE shipment_id = $1 ORDER BY created_at DESC', [shipment.id]);

    let courier = null;
    if (shipment.courier_id) {
      const { rows: cRows } = await pool.query('SELECT id, courier_id, name, phone, vehicle_type, avatar FROM couriers WHERE courier_id = $1', [shipment.courier_id]);
      courier = cRows[0] || null;
    }

    res.json({ shipment, history, courier });
  } catch (err) {
    console.error('Get shipment error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// POST /api/shipments — Create new shipment
router.post('/', authMiddleware, async (req, res) => {
  try {
    const {
      sender_name, sender_email, sender_phone,
      receiver_name, receiver_email, receiver_phone,
      origin, destination, origin_lat, origin_lng, dest_lat, dest_lng,
      courier_id, customer_id, weight, dimensions, cargo_type,
      description, declared_value, insurance, estimated_delivery, special_instructions,
      route_data, transport_modes, route_distance, route_duration, route_summary,
      multi_modal_segments, multi_modal_stops
    } = req.body;

    if (!sender_name || !receiver_name || !origin || !destination) {
      return res.status(400).json({ error: 'sender_name, receiver_name, origin, and destination are required.' });
    }

    // Validate courier exists if provided
    if (courier_id) {
      const { rows: cRows } = await pool.query('SELECT id FROM couriers WHERE courier_id = $1', [courier_id]);
      if (cRows.length === 0) return res.status(400).json({ error: 'Courier not found.' });
    }

    // Generate unique tracking ID
    let trackingId;
    let attempts = 0;
    do {
      trackingId = generateTrackingId();
      const { rows: dup } = await pool.query('SELECT id FROM shipments WHERE tracking_id = $1', [trackingId]);
      if (dup.length === 0) break;
      attempts++;
    } while (attempts < 10);

    const initialStatus = courier_id ? 'picked-up' : 'pending';
    const estDelivery = estimated_delivery || new Date(Date.now() + 5 * 86400000).toISOString().split('T')[0];
    const departedAt = courier_id ? new Date().toISOString() : null;

    const { rows: inserted } = await pool.query(`
      INSERT INTO shipments (
        tracking_id, sender_name, sender_email, sender_phone,
        receiver_name, receiver_email, receiver_phone,
        origin, destination, origin_lat, origin_lng, dest_lat, dest_lng,
        status, courier_id, customer_id, weight, dimensions, cargo_type,
        description, declared_value, insurance, estimated_delivery, special_instructions,
        route_data, transport_modes, route_distance, route_duration, route_summary,
        departed_at, multi_modal_segments, multi_modal_stops
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32) RETURNING *
    `, [
      trackingId,
      sender_name, sender_email || null, sender_phone || null,
      receiver_name, receiver_email || null, receiver_phone || null,
      origin, destination,
      origin_lat || null, origin_lng || null, dest_lat || null, dest_lng || null,
      initialStatus, courier_id || null, customer_id || null,
      weight || null, dimensions || null, cargo_type || 'General',
      description || null, declared_value || null, insurance ? true : false,
      estDelivery, special_instructions || null,
      route_data ? JSON.stringify(route_data) : null,
      transport_modes ? JSON.stringify(transport_modes) : null,
      route_distance || null, route_duration || null, route_summary || null,
      departedAt,
      multi_modal_segments ? (typeof multi_modal_segments === 'string' ? multi_modal_segments : JSON.stringify(multi_modal_segments)) : null,
      multi_modal_stops ? (typeof multi_modal_stops === 'string' ? multi_modal_stops : JSON.stringify(multi_modal_stops)) : null
    ]);

    const shipment = inserted[0];

    // Add tracking history entry
    await pool.query(
      'INSERT INTO tracking_history (shipment_id, tracking_id, status, location, notes, updated_by) VALUES ($1, $2, $3, $4, $5, $6)',
      [shipment.id, trackingId, initialStatus, origin, 'Shipment created.', req.user.username || req.user.email || 'admin']
    );

    // Notification
    await pool.query('INSERT INTO notifications (title, message, type, link) VALUES ($1, $2, $3, $4)', [
      'New Shipment Created',
      `Shipment ${trackingId} from ${origin} to ${destination}.`,
      'info',
      `/shipments/${trackingId}`
    ]);

    // ── Send confirmation emails BEFORE responding (required for serverless) ──
    try {
      const recipients = [];
      if (shipment.sender_email) recipients.push({ email: shipment.sender_email, name: shipment.sender_name, role: 'sender' });
      if (shipment.receiver_email) recipients.push({ email: shipment.receiver_email, name: shipment.receiver_name, role: 'receiver' });

      const emailPromises = recipients.map(async r => {
        const emailData = buildShipmentCreationEmail({ shipment, role: r.role });
        const result = await sendMail({ to: r.email, subject: emailData.subject, html: emailData.html, text: emailData.text });
        if (result.success) {
          await pool.query(
            `INSERT INTO email_drafts (type, recipient_email, recipient_name, subject, html_body, text_body, status, related_tracking_id, sent_at)
             VALUES ($1, $2, $3, $4, $5, $6, 'sent', $7, NOW())`,
            ['tracking_update', r.email, r.name, emailData.subject, emailData.html, emailData.text, shipment.tracking_id]
          );
        }
        return result;
      });
      await Promise.allSettled(emailPromises);
    } catch (emailErr) {
      console.error('Shipment creation email error:', emailErr.message);
    }

    res.status(201).json({ shipment });
  } catch (err) {
    console.error('Create shipment error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// PATCH /api/shipments/:id/status — Update shipment status
router.patch('/:id/status', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM shipments WHERE id::text = $1 OR tracking_id = $1', [req.params.id]);
    const shipment = rows[0];
    if (!shipment) return res.status(404).json({ error: 'Shipment not found.' });

    const { status, location, lat, lng, notes } = req.body;
    const validStatuses = ['pending', 'picked-up', 'in-transit', 'out-for-delivery', 'delivered', 'returned', 'paused'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
    }

    const wasPaused = !!shipment.is_paused;
    const nowBecomingPaused = status === 'paused';
    const nowBecomingUnpaused = wasPaused && !nowBecomingPaused;
    const nowIso = new Date().toISOString();

    // ── Pause timing fields ──────────────────────────────────────────
    // If PAUSING: record paused_at timestamp so timer freezes correctly.
    // If RESUMING: accumulate total_paused_ms so future ETA is correct.
    let pausedAt = shipment.paused_at;           // keep existing by default
    let totalPausedMs = parseInt(shipment.total_paused_ms) || 0;
    let isPaused = wasPaused;                    // keep existing by default

    // Recalculate estimated_delivery when resuming — extend it by the duration of the pause.
    // This means the arrival date shown in the table & tracking page is always accurate.
    let newEstimatedDelivery = shipment.estimated_delivery || null;

    if (nowBecomingPaused && !wasPaused) {
      // Freshly pausing
      pausedAt = nowIso;
      isPaused = true;
    } else if (nowBecomingUnpaused) {
      // Resuming — accumulate duration of this pause session
      let pauseDurationMs = 0;
      if (shipment.paused_at) {
        pauseDurationMs = Date.now() - new Date(shipment.paused_at).getTime();
        totalPausedMs += pauseDurationMs;
      }
      pausedAt = null;
      isPaused = false;

      // Extend estimated_delivery by the pause duration
      if (newEstimatedDelivery && pauseDurationMs > 0) {
        const estStr = newEstimatedDelivery.includes('T')
          ? newEstimatedDelivery
          : newEstimatedDelivery + 'T23:59:59Z';
        const newEstMs = new Date(estStr).getTime() + pauseDurationMs;
        newEstimatedDelivery = new Date(newEstMs).toISOString().split('T')[0];
      }
    }
    // ────────────────────────────────────────────────────────────────

    // ── Compute progress: when PAUSING, snapshot the live value at this instant ──
    let progress;
    if (nowBecomingPaused && !wasPaused) {
      // Compute the current real-time progress right now and freeze it in the DB
      progress = computeProgress(shipment); // shipment still has is_paused=false here
    } else {
      const progressMap = { 'pending': 0, 'picked-up': 15, 'in-transit': 50, 'out-for-delivery': 85, 'delivered': 100, 'returned': 100, 'paused': shipment.progress };
      progress = progressMap[status] ?? shipment.progress;
    }
    const actualDelivery = status === 'delivered' ? new Date().toISOString().split('T')[0] : null;

    // Set departed_at when shipment first starts moving
    let departedAt = shipment.departed_at;
    if (!departedAt && ['picked-up', 'in-transit', 'out-for-delivery'].includes(status)) {
      departedAt = nowIso;
    }

    await pool.query(`
      UPDATE shipments SET
        status = $1, progress = $2, is_paused = $3,
        paused_at = $4,
        total_paused_ms = $5,
        estimated_delivery = COALESCE($6, estimated_delivery),
        current_lat = COALESCE($7, current_lat),
        current_lng = COALESCE($8, current_lng),
        actual_delivery = COALESCE($9, actual_delivery),
        departed_at = COALESCE($10, departed_at)
      WHERE id = $11
    `, [status, progress, isPaused, pausedAt, totalPausedMs, newEstimatedDelivery, lat || null, lng || null, actualDelivery, departedAt, shipment.id]);

    // Add tracking history
    const historyNote = notes || (nowBecomingPaused && !wasPaused ? 'Shipment paused.' : nowBecomingUnpaused ? 'Shipment resumed.' : null);
    await pool.query(
      'INSERT INTO tracking_history (shipment_id, tracking_id, status, location, lat, lng, notes, updated_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [shipment.id, shipment.tracking_id, status, location || null, lat || null, lng || null, historyNote, req.user.username || req.user.email || 'admin']
    );

    // Update courier delivery count if delivered
    if (status === 'delivered' && shipment.courier_id) {
      await pool.query('UPDATE couriers SET total_deliveries = total_deliveries + 1 WHERE courier_id = $1', [shipment.courier_id]);
    }

    // Add notification
    if (nowBecomingPaused && !wasPaused) {
      await pool.query('INSERT INTO notifications (title, message, type) VALUES ($1, $2, $3)', [
        'Shipment Paused',
        `${shipment.tracking_id}: Shipment paused via status update.`,
        'warning'
      ]);
    } else if (nowBecomingUnpaused) {
      await pool.query('INSERT INTO notifications (title, message, type) VALUES ($1, $2, $3)', [
        'Shipment Resumed',
        `${shipment.tracking_id}: Shipment resumed via status update.`,
        'info'
      ]);
    }

    const { rows: updated } = await pool.query('SELECT * FROM shipments WHERE id = $1', [shipment.id]);

    // ── Send emails ──────────────────────────────────────────────────
    // For pause/resume transitions: send the dedicated pause email (richer content).
    // For all other status changes: send the standard status-change email.
    try {
      const recipients = [];
      if (shipment.sender_email) recipients.push({ email: shipment.sender_email, name: shipment.sender_name, role: 'sender' });
      if (shipment.receiver_email && shipment.receiver_email !== shipment.sender_email)
        recipients.push({ email: shipment.receiver_email, name: shipment.receiver_name, role: 'receiver' });

      const isPauseTransition = (nowBecomingPaused && !wasPaused) || nowBecomingUnpaused;

      if (isPauseTransition) {
        // ── Pause / Resume email (same rich template as the /pause route) ──
        const { rows: histRows } = await pool.query(
          'SELECT location FROM tracking_history WHERE shipment_id = $1 AND location IS NOT NULL ORDER BY created_at DESC LIMIT 1',
          [shipment.id]
        );
        const lastLocation = histRows[0]?.location || null;

        const emailPromises = recipients.map(async r => {
          const emailData = buildShipmentPauseEmail({
            shipment,
            isPaused: nowBecomingPaused,
            pauseCategory: nowBecomingPaused ? (notes || null) : null,
            pauseReason: null,
            location: nowBecomingPaused ? lastLocation : null,
            pausedAt: nowBecomingPaused ? nowIso : null,
          });
          const result = await sendMail({ to: r.email, subject: emailData.subject, html: emailData.html, text: emailData.text });
          if (result.success) {
            await pool.query(
              `INSERT INTO email_drafts (type, recipient_email, recipient_name, subject, html_body, text_body, status, related_tracking_id, sent_at)
               VALUES ($1, $2, $3, $4, $5, $6, 'sent', $7, NOW())`,
              ['tracking_update', r.email, r.name, emailData.subject, emailData.html, emailData.text, shipment.tracking_id]
            );
          }
          return result;
        });
        await Promise.allSettled(emailPromises);
      } else {
        // ── Standard status-change email ──
        const emailPromises = recipients.map(async r => {
          const emailData = buildShipmentStatusChangeEmail({
            shipment,
            newStatus: status,
            role: r.role,
            notes: notes || null,
          });
          const result = await sendMail({ to: r.email, subject: emailData.subject, html: emailData.html, text: emailData.text });
          if (result.success) {
            await pool.query(
              `INSERT INTO email_drafts (type, recipient_email, recipient_name, subject, html_body, text_body, status, related_tracking_id, sent_at)
               VALUES ($1, $2, $3, $4, $5, $6, 'sent', $7, NOW())`,
              ['tracking_update', r.email, r.name, emailData.subject, emailData.html, emailData.text, shipment.tracking_id]
            );
          }
          return result;
        });
        await Promise.allSettled(emailPromises);
      }
    } catch (emailErr) {
      console.error('Status change email error:', emailErr.message);
    }

    // Create email drafts for tracking subscribers
    if (createTrackingUpdateDraft) {
      const statusLabels = {
        'pending': 'Order Confirmed',
        'picked-up': 'Picked Up',
        'in-transit': 'In Transit',
        'out-for-delivery': 'Out for Delivery',
        'delivered': 'Delivered',
        'returned': 'Returned',
        'paused': 'On Hold',
      };
      try {
        await createTrackingUpdateDraft({
          trackingId: shipment.tracking_id,
          status,
          statusLabel: statusLabels[status] || status,
          location: location || null,
          notes: historyNote,
        });
      } catch (err) {
        console.error('Tracking draft error:', err.message);
      }
    }

    res.json({ shipment: updated[0] });
  } catch (err) {
    console.error('Update shipment status error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// PATCH /api/shipments/:id/assign — Assign courier to shipment
router.patch('/:id/assign', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM shipments WHERE id::text = $1 OR tracking_id = $1', [req.params.id]);
    const shipment = rows[0];
    if (!shipment) return res.status(404).json({ error: 'Shipment not found.' });

    const { courier_id } = req.body;
    if (!courier_id) return res.status(400).json({ error: 'courier_id is required.' });

    const { rows: cRows } = await pool.query('SELECT * FROM couriers WHERE courier_id = $1', [courier_id]);
    const courier = cRows[0];
    if (!courier) return res.status(404).json({ error: 'Courier not found.' });

    await pool.query(
      "UPDATE shipments SET courier_id = $1, status = CASE WHEN status = 'pending' THEN 'picked-up' ELSE status END WHERE id = $2",
      [courier_id, shipment.id]
    );

    await pool.query("UPDATE couriers SET status = 'on-delivery' WHERE courier_id = $1", [courier_id]);

    await pool.query(
      'INSERT INTO tracking_history (shipment_id, tracking_id, status, notes, updated_by) VALUES ($1, $2, $3, $4, $5)',
      [shipment.id, shipment.tracking_id, 'picked-up', `Assigned to courier ${courier.name} (${courier_id}).`, req.user.username || req.user.email || 'admin']
    );

    const { rows: updated } = await pool.query('SELECT * FROM shipments WHERE id = $1', [shipment.id]);
    res.json({ shipment: updated[0] });
  } catch (err) {
    console.error('Assign courier error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// PATCH /api/shipments/:id/pause — Toggle pause/resume
router.patch('/:id/pause', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM shipments WHERE id::text = $1 OR tracking_id = $1', [req.params.id]);
    const shipment = rows[0];
    if (!shipment) return res.status(404).json({ error: 'Shipment not found.' });

    const { pause_category, pause_reason } = req.body || {};

    const newPaused = !shipment.is_paused;
    const newStatus = newPaused ? 'paused' : 'in-transit';

    // Build descriptive action text
    let action = newPaused ? 'Shipment paused.' : 'Shipment resumed.';
    if (newPaused && pause_category) {
      action = `Paused — ${pause_category}`;
      if (pause_reason) action += `: ${pause_reason}`;
    }

    const nowIso = new Date().toISOString();
    if (newPaused) {
      // Pausing: snapshot the live progress at this instant + record paused_at + reason
      const frozenProgress = computeProgress(shipment); // shipment still has is_paused=false here
      await pool.query(`UPDATE shipments SET is_paused = TRUE, status = $1, paused_at = $2,
        pause_category = $3, pause_reason = $4, progress = $5 WHERE id = $6`,
        [newStatus, nowIso, pause_category || null, pause_reason || null, frozenProgress, shipment.id]);
    } else {
      // Resuming: accumulate paused duration, clear reason, extend estimated_delivery
      let accumulatedMs = parseInt(shipment.total_paused_ms) || 0;
      let pauseDurationMs = 0;
      if (shipment.paused_at) {
        pauseDurationMs = Date.now() - new Date(shipment.paused_at).getTime();
        accumulatedMs += pauseDurationMs;
      }

      // Recalculate estimated delivery — extend it by the exact pause duration
      let newEstDelivery = shipment.estimated_delivery || null;
      if (newEstDelivery && pauseDurationMs > 0) {
        const estStr = newEstDelivery.includes('T')
          ? newEstDelivery
          : newEstDelivery + 'T23:59:59Z';
        const newEstMs = new Date(estStr).getTime() + pauseDurationMs;
        newEstDelivery = new Date(newEstMs).toISOString().split('T')[0];
      }

      await pool.query(`UPDATE shipments SET is_paused = FALSE, status = $1, paused_at = NULL, total_paused_ms = $2,
        pause_category = NULL, pause_reason = NULL,
        estimated_delivery = COALESCE($3, estimated_delivery)
        WHERE id = $4`,
        [newStatus, accumulatedMs, newEstDelivery, shipment.id]);
    }

    await pool.query(
      'INSERT INTO tracking_history (shipment_id, tracking_id, status, notes, updated_by) VALUES ($1, $2, $3, $4, $5)',
      [shipment.id, shipment.tracking_id, newStatus, action, req.user.username || req.user.email || 'admin']
    );

    await pool.query('INSERT INTO notifications (title, message, type) VALUES ($1, $2, $3)', [
      newPaused ? 'Shipment Paused' : 'Shipment Resumed',
      `${shipment.tracking_id}: ${action}`,
      newPaused ? 'warning' : 'info'
    ]);

    const { rows: updated } = await pool.query('SELECT * FROM shipments WHERE id = $1', [shipment.id]);

    // ── Send pause/resume email to BOTH sender & receiver BEFORE responding ──
    try {
      const { rows: histRows } = await pool.query('SELECT location FROM tracking_history WHERE shipment_id = $1 AND location IS NOT NULL ORDER BY created_at DESC LIMIT 1', [shipment.id]);
      const lastLocation = histRows[0]?.location || null;

      const recipients = [];
      if (shipment.sender_email) recipients.push({ email: shipment.sender_email, name: shipment.sender_name });
      if (shipment.receiver_email && shipment.receiver_email !== shipment.sender_email) recipients.push({ email: shipment.receiver_email, name: shipment.receiver_name });
      
      const emailPromises = recipients.map(async r => {
        const emailData = buildShipmentPauseEmail({
          shipment,
          isPaused: newPaused,
          pauseCategory: newPaused ? (pause_category || null) : null,
          pauseReason: newPaused ? (pause_reason || null) : null,
          location: newPaused ? lastLocation : null,
          pausedAt: newPaused ? nowIso : null,
        });
        const result = await sendMail({ to: r.email, subject: emailData.subject, html: emailData.html, text: emailData.text });
        if (result.success) {
          // Log to email_drafts so it shows up in the admin Mail section
          await pool.query(
            `INSERT INTO email_drafts (type, recipient_email, recipient_name, subject, html_body, text_body, status, related_tracking_id, sent_at)
             VALUES ($1, $2, $3, $4, $5, $6, 'sent', $7, NOW())`,
            ['tracking_update', r.email, r.name, emailData.subject, emailData.html, emailData.text, shipment.tracking_id]
          );
        }
        return result;
      });
      await Promise.allSettled(emailPromises);
    } catch (emailErr) {
      console.error('Pause email error:', emailErr.message);
    }

    // Create tracking update drafts for subscribers
    if (createTrackingUpdateDraft) {
      try {
        await createTrackingUpdateDraft({
          trackingId: shipment.tracking_id,
          status: newStatus,
          statusLabel: newPaused ? 'On Hold' : 'Resumed — In Transit',
          location: null,
          notes: action,
          pauseCategory: newPaused ? (pause_category || null) : null,
          pauseReason: newPaused ? (pause_reason || null) : null,
        });
      } catch (err) {
        console.error('Tracking draft error:', err.message);
      }
    }

    res.json({ shipment: updated[0] });
  } catch (err) {
    console.error('Pause/Resume error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// PUT /api/shipments/:id — Full update
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM shipments WHERE id::text = $1 OR tracking_id = $1', [req.params.id]);
    const shipment = rows[0];
    if (!shipment) return res.status(404).json({ error: 'Shipment not found.' });

    const {
      sender_name, sender_email, sender_phone,
      receiver_name, receiver_email, receiver_phone,
      origin, destination, weight, dimensions, cargo_type,
      description, declared_value, insurance, estimated_delivery, special_instructions
    } = req.body;

    await pool.query(`
      UPDATE shipments SET
        sender_name = COALESCE($1, sender_name),
        sender_email = COALESCE($2, sender_email),
        sender_phone = COALESCE($3, sender_phone),
        receiver_name = COALESCE($4, receiver_name),
        receiver_email = COALESCE($5, receiver_email),
        receiver_phone = COALESCE($6, receiver_phone),
        origin = COALESCE($7, origin),
        destination = COALESCE($8, destination),
        weight = COALESCE($9, weight),
        dimensions = COALESCE($10, dimensions),
        cargo_type = COALESCE($11, cargo_type),
        description = COALESCE($12, description),
        declared_value = COALESCE($13, declared_value),
        insurance = COALESCE($14, insurance),
        estimated_delivery = COALESCE($15, estimated_delivery),
        special_instructions = COALESCE($16, special_instructions)
      WHERE id = $17
    `, [
      sender_name || null, sender_email || null, sender_phone || null,
      receiver_name || null, receiver_email || null, receiver_phone || null,
      origin || null, destination || null, weight || null, dimensions || null,
      cargo_type || null, description || null, declared_value || null,
      insurance != null ? (insurance ? true : false) : null,
      estimated_delivery || null, special_instructions || null,
      shipment.id
    ]);

    const { rows: updated } = await pool.query('SELECT * FROM shipments WHERE id = $1', [shipment.id]);
    res.json({ shipment: updated[0] });
  } catch (err) {
    console.error('Update shipment error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// DELETE /api/shipments/:id
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM shipments WHERE id::text = $1 OR tracking_id = $1', [req.params.id]);
    const shipment = rows[0];
    if (!shipment) return res.status(404).json({ error: 'Shipment not found.' });

    await pool.query('DELETE FROM tracking_history WHERE shipment_id = $1', [shipment.id]);
    await pool.query('DELETE FROM shipments WHERE id = $1', [shipment.id]);
    res.json({ message: 'Shipment deleted successfully.' });
  } catch (err) {
    console.error('Delete shipment error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

module.exports = router;
