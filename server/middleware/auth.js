const jwt = require('jsonwebtoken');
const { supabase } = require('../db');
require('dotenv').config();

const SECRET = process.env.JWT_SECRET;
if (!SECRET || SECRET.length < 32) {
  console.error('FATAL: JWT_SECRET must be set in .env and be at least 32 characters.');
  process.exit(1);
}

/**
 * Auth middleware.
 *
 * Accepts two token types:
 *  1. Supabase access_token   — verified via supabase.auth.getUser()
 *                               Auto-refreshed if a refresh_token cookie/header is present.
 *  2. Legacy HS256 JWT        — verified against JWT_SECRET (never expires unless revoked)
 *
 * On any valid auth the middleware attaches req.user and calls next().
 * On failure it returns 401 with a clear message.
 */
async function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  const token = header.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Access denied. Token is empty.' });
  }

  // ── 1. Try Supabase token verification ──────────────────────────────
  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (!error && user) {
      req.user = {
        id: user.id,
        email: user.email,
        role: 'admin',
      };
      return next();
    }
  } catch (_supaErr) {
    // Supabase call failed — try refresh or fall through to JWT
  }

  // ── 2. Try token refresh using X-Refresh-Token header ───────────────
  //    Frontend sends this header when it knows the access token may be stale.
  const refreshToken = req.headers['x-refresh-token'];
  if (refreshToken) {
    try {
      const { data, error: refreshErr } = await supabase.auth.refreshSession({
        refresh_token: refreshToken,
      });

      if (!refreshErr && data?.session?.access_token && data?.user) {
        req.user = {
          id: data.user.id,
          email: data.user.email,
          role: 'admin',
        };
        // Return the new tokens to the client via response headers
        res.setHeader('X-New-Access-Token', data.session.access_token);
        res.setHeader('X-New-Refresh-Token', data.session.refresh_token);
        res.setHeader('Access-Control-Expose-Headers', 'X-New-Access-Token, X-New-Refresh-Token');
        return next();
      }
    } catch (_refreshErr) {
      // Refresh failed — fall through to legacy JWT
    }
  }

  // ── 3. Fallback: Legacy HS256 JWT (long-lived, no expiry issues) ─────
  try {
    const decoded = jwt.verify(token, SECRET, { algorithms: ['HS256'] });
    req.user = decoded;
    return next();
  } catch (jwtErr) {
    // Give a specific message depending on the error
    if (jwtErr.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: 'Session expired. Please log in again.',
        expired: true,
      });
    }
    return res.status(401).json({ error: 'Invalid or expired token. Please log in again.' });
  }
}

/**
 * Generate a long-lived HS256 JWT (30 days).
 * Used as a fallback for non-Supabase auth and internal service calls.
 */
function generateToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, email: user.email, role: user.role },
    SECRET,
    { algorithm: 'HS256', expiresIn: '30d' }
  );
}

module.exports = { authMiddleware, generateToken };
