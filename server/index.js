const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

// Import routes
const authRoutes = require('./routes/auth');
const courierRoutes = require('./routes/couriers');
const customerRoutes = require('./routes/customers');
const shipmentRoutes = require('./routes/shipments');
const dashboardRoutes = require('./routes/dashboard');
const messageRoutes = require('./routes/messages');
const quoteRoutes = require('./routes/quotes');
const reviewRoutes = require('./routes/reviews');
const emailRoutes = require('./routes/emails');
const routingRoutes = require('./routes/routing');
const settingsRoutes = require('./routes/settings');

const app = express();
const PORT = process.env.PORT || 5000;

// ─── SECURITY MIDDLEWARE ─────────────────────────────────────────────
app.use(helmet());
app.disable('x-powered-by');

// CORS — allow all origins safely
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Refresh-Token'],
  exposedHeaders: ['X-New-Access-Token', 'X-New-Refresh-Token'],
}));

// Rate limiting — global (generous for admin dashboard heavy usage)
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 2000, // 2000 requests per 15 min per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
  skip: (req) => req.headers.authorization?.startsWith('Bearer '), // skip for authenticated requests
});
app.use(globalLimiter);

// Strict rate limiting on auth login ONLY (anti brute-force) — not on /refresh
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30, // 30 login attempts per 15 min
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
  skip: (req) => req.path === '/refresh', // token refresh is not brute-forceable
});

// Strict rate limiting on public endpoints (anti spam)
const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// Request logger
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`);
  });
  next();
});

// ─── ROUTES ──────────────────────────────────────────────────────────
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/couriers', courierRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/shipments', shipmentRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/quotes', publicLimiter, quoteRoutes);
app.use('/api/reviews', publicLimiter, reviewRoutes);
app.use('/api/emails', emailRoutes);
app.use('/api/routing', routingRoutes);
app.use('/api/settings', settingsRoutes);

// Root route — minimal, no API map exposed
app.get('/', (req, res) => {
  res.json({ name: 'Happy Paw Trace API', status: 'running' });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '2.0.0', name: 'Happy Paw Trace API' });
});

// 404 handler — don't reflect the URL back (prevents reflected content attacks)
app.use((req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

// Error handler — never leak stack traces
app.use((err, req, res, next) => {
  if (err.message === 'Blocked by CORS') {
    return res.status(403).json({ error: 'Origin not allowed.' });
  }
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error.' });
});

// ─── START SERVER ────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`\n🚀 Happy Paw Trace API Server running on http://localhost:${PORT}`);
    console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
    console.log(`\nAPI Endpoints:`);
    console.log(`  POST   /api/auth/register`);
    console.log(`  POST   /api/auth/login`);
    console.log(`  GET    /api/auth/me`);
    console.log(`  GET    /api/couriers`);
    console.log(`  POST   /api/couriers`);
    console.log(`  GET    /api/customers`);
    console.log(`  POST   /api/customers`);
    console.log(`  GET    /api/shipments`);
    console.log(`  POST   /api/shipments`);
    console.log(`  GET    /api/shipments/:id/track  (public)`);
    console.log(`  GET    /api/dashboard/stats`);
    console.log(`  GET    /api/dashboard/active-map`);
    console.log(`  POST   /api/messages/conversations  (public)`);
    console.log(`  POST   /api/messages/send            (public)`);
    console.log(`  GET    /api/messages/admin/conversations`);
    console.log(`  POST   /api/quotes                (public)`);
    console.log(`  GET    /api/quotes/admin           (admin)`);
    console.log(`  PATCH  /api/quotes/admin/:id/status (admin)`);
    console.log(`  POST   /api/reviews              (public)`);
    console.log(`  GET    /api/reviews/approved       (public)`);
    console.log(`  GET    /api/reviews/admin           (admin)`);
    console.log(`  PATCH  /api/reviews/admin/:id/approve (admin)`);
    console.log(`  DELETE /api/reviews/admin/:id       (admin)`);
    console.log(`\n`);
  });
}

// Export for Vercel Serverless
module.exports = app;
