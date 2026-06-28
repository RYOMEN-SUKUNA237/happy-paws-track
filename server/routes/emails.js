const express = require('express');
const { pool, supabase } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { sendMail, buildSupportNotificationEmail, buildTrackingUpdateEmail, emailTemplate, FRONTEND_URL, COMPANY_NAME } = require('../utils/mailer');

const router = express.Router();


// ─── HELPER: Get all admin emails from Supabase Auth ─────────────────
async function getAdminEmails() {
  try {
    const { data, error } = await supabase.auth.admin.listUsers();
    if (error) throw error;
    return data.users.map(u => u.email).filter(Boolean);
  } catch (err) {
    console.error('Failed to get admin emails:', err.message);
    return [];
  }
}

// ─── HELPER: Notify all admins about support messages ────────────────
async function notifyAdminsAboutSupport({ visitorName, visitorEmail, messageContent, conversationId }) {
  const adminEmails = await getAdminEmails();
  if (adminEmails.length === 0) {
    console.log('⚠️ No admin emails found for notification');
    return;
  }

  const emailData = buildSupportNotificationEmail({
    visitorName,
    visitorEmail,
    messageContent,
    conversationId,
  });

  // Send to all admins
  const results = await Promise.allSettled(
    adminEmails.map(email =>
      sendMail({
        to: email,
        subject: emailData.subject,
        html: emailData.html,
        text: emailData.text,
      })
    )
  );

  const sent = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
  console.log(`📧 Support notification sent to ${sent}/${adminEmails.length} admins`);
}

// ─── HELPER: Create email draft for tracking update ──────────────────
async function createTrackingUpdateDraft({ trackingId, status, statusLabel, location, notes, pauseCategory, pauseReason }) {
  try {
    // Get subscribers for this tracking ID
    const { rows: subscribers } = await pool.query(
      'SELECT * FROM tracking_subscribers WHERE tracking_id = $1 AND is_active = TRUE',
      [trackingId]
    );

    if (subscribers.length === 0) return;

    // Create a draft for each subscriber
    for (const sub of subscribers) {
      const emailData = buildTrackingUpdateEmail({
        trackingId,
        status,
        statusLabel,
        location,
        notes,
        recipientName: sub.name,
        pauseCategory,
        pauseReason,
      });

      await pool.query(
        `INSERT INTO email_drafts (type, recipient_email, recipient_name, subject, html_body, text_body, status, related_tracking_id, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, 'draft', $7, $8)`,
        [
          'tracking_update',
          sub.email,
          sub.name,
          emailData.subject,
          emailData.html,
          emailData.text,
          trackingId,
          JSON.stringify({ status, statusLabel, location, notes, pauseCategory, pauseReason }),
        ]
      );
    }

    console.log(`📝 Created ${subscribers.length} email draft(s) for ${trackingId} status: ${statusLabel}`);
  } catch (err) {
    console.error('Create tracking update draft error:', err.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// PUBLIC: Subscribe to tracking updates
// ═══════════════════════════════════════════════════════════════════════

router.post('/subscribe', async (req, res) => {
  try {
    const { tracking_id, email, name } = req.body;

    if (!tracking_id || !email) {
      return res.status(400).json({ error: 'tracking_id and email are required.' });
    }

    // Validate email format
    if (!/\S+@\S+\.\S+/.test(email)) {
      return res.status(400).json({ error: 'Invalid email address.' });
    }

    // Verify tracking ID exists
    const { rows: shipmentRows } = await pool.query(
      'SELECT tracking_id FROM shipments WHERE tracking_id = $1',
      [tracking_id]
    );
    if (shipmentRows.length === 0) {
      return res.status(404).json({ error: 'Invalid tracking ID. Please enter a valid tracking number.' });
    }

    // Upsert subscriber
    await pool.query(
      `INSERT INTO tracking_subscribers (tracking_id, email, name, is_active)
       VALUES ($1, $2, $3, TRUE)
       ON CONFLICT (tracking_id, email) DO UPDATE SET is_active = TRUE, name = COALESCE($3, tracking_subscribers.name)`,
      [tracking_id, email, name || null]
    );

    res.status(201).json({
      message: 'Successfully subscribed! You will receive email updates for this shipment.',
    });
  } catch (err) {
    console.error('Subscribe error:', err.message);
    res.status(500).json({ error: 'Failed to subscribe.' });
  }
});

// Public: Unsubscribe
router.post('/unsubscribe', async (req, res) => {
  try {
    const { tracking_id, email } = req.body;
    if (!tracking_id || !email) {
      return res.status(400).json({ error: 'tracking_id and email are required.' });
    }

    await pool.query(
      'UPDATE tracking_subscribers SET is_active = FALSE WHERE tracking_id = $1 AND email = $2',
      [tracking_id, email]
    );

    res.json({ message: 'Unsubscribed successfully.' });
  } catch (err) {
    console.error('Unsubscribe error:', err.message);
    res.status(500).json({ error: 'Failed to unsubscribe.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// ADMIN: List email drafts
// ═══════════════════════════════════════════════════════════════════════

router.get('/admin/drafts', authMiddleware, async (req, res) => {
  try {
    const { status, type, search } = req.query;
    let sql = 'SELECT * FROM email_drafts WHERE 1=1';
    const params = [];

    if (status && status !== 'all') {
      params.push(status);
      sql += ` AND status = $${params.length}`;
    }
    if (type && type !== 'all') {
      params.push(type);
      sql += ` AND type = $${params.length}`;
    }
    if (search) {
      params.push(`%${search}%`);
      sql += ` AND (recipient_email ILIKE $${params.length} OR recipient_name ILIKE $${params.length} OR subject ILIKE $${params.length})`;
    }

    sql += ' ORDER BY created_at DESC LIMIT 100';
    const { rows: drafts } = await pool.query(sql, params);

    // Get counts
    const { rows: [counts] } = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'draft') as draft_count,
        COUNT(*) FILTER (WHERE status = 'sent') as sent_count,
        COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled_count,
        COUNT(*) as total
      FROM email_drafts
    `);

    res.json({ drafts, counts });
  } catch (err) {
    console.error('List drafts error:', err.message);
    res.status(500).json({ error: 'Failed to fetch drafts.' });
  }
});

// ADMIN: Get single draft
router.get('/admin/drafts/:id', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM email_drafts WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Draft not found.' });
    res.json({ draft: rows[0] });
  } catch (err) {
    console.error('Get draft error:', err.message);
    res.status(500).json({ error: 'Failed to fetch draft.' });
  }
});

// ADMIN: Update draft (edit subject/body before sending)
router.put('/admin/drafts/:id', authMiddleware, async (req, res) => {
  try {
    const { subject, html_body, text_body } = req.body;
    const { rows } = await pool.query(
      `UPDATE email_drafts SET
        subject = COALESCE($1, subject),
        html_body = COALESCE($2, html_body),
        text_body = COALESCE($3, text_body)
      WHERE id = $4 AND status = 'draft' RETURNING *`,
      [subject || null, html_body || null, text_body || null, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Draft not found or already sent.' });
    res.json({ draft: rows[0], message: 'Draft updated.' });
  } catch (err) {
    console.error('Update draft error:', err.message);
    res.status(500).json({ error: 'Failed to update draft.' });
  }
});

// ADMIN: Confirm and send a draft
router.post('/admin/drafts/:id/send', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM email_drafts WHERE id = $1', [req.params.id]);
    const draft = rows[0];
    if (!draft) return res.status(404).json({ error: 'Draft not found.' });
    if (draft.status === 'sent') return res.status(400).json({ error: 'Email already sent.' });

    // Send the email
    const result = await sendMail({
      to: draft.recipient_email,
      subject: draft.subject,
      html: draft.html_body,
      text: draft.text_body,
    });

    if (result.success) {
      await pool.query(
        "UPDATE email_drafts SET status = 'sent', sent_at = NOW() WHERE id = $1",
        [draft.id]
      );
      res.json({ message: 'Email sent successfully!', messageId: result.messageId });
    } else {
      res.status(500).json({ error: `Failed to send: ${result.error}` });
    }
  } catch (err) {
    console.error('Send draft error:', err.message);
    res.status(500).json({ error: 'Failed to send email.' });
  }
});

// ADMIN: Cancel a draft
router.patch('/admin/drafts/:id/cancel', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "UPDATE email_drafts SET status = 'cancelled' WHERE id = $1 AND status = 'draft' RETURNING *",
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Draft not found or already processed.' });
    res.json({ message: 'Draft cancelled.' });
  } catch (err) {
    console.error('Cancel draft error:', err.message);
    res.status(500).json({ error: 'Failed to cancel draft.' });
  }
});

// ADMIN: Delete a draft
router.delete('/admin/drafts/:id', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query('DELETE FROM email_drafts WHERE id = $1 RETURNING id', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Draft not found.' });
    res.json({ message: 'Draft deleted.' });
  } catch (err) {
    console.error('Delete draft error:', err.message);
    res.status(500).json({ error: 'Failed to delete draft.' });
  }
});

// ADMIN: Get subscribers for a tracking ID
router.get('/admin/subscribers', authMiddleware, async (req, res) => {
  try {
    const { tracking_id } = req.query;
    let sql = 'SELECT * FROM tracking_subscribers WHERE is_active = TRUE';
    const params = [];
    if (tracking_id) {
      params.push(tracking_id);
      sql += ` AND tracking_id = $${params.length}`;
    }
    sql += ' ORDER BY subscribed_at DESC';
    const { rows } = await pool.query(sql, params);
    res.json({ subscribers: rows });
  } catch (err) {
    console.error('List subscribers error:', err.message);
    res.status(500).json({ error: 'Failed to fetch subscribers.' });
  }
});

module.exports = router;
module.exports.notifyAdminsAboutSupport = notifyAdminsAboutSupport;
module.exports.createTrackingUpdateDraft = createTrackingUpdateDraft;
