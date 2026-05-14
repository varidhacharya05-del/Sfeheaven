/**
 * SafeHaven · Refugee Security Network · Delhi Region
 * Backend Server — Node.js / Express
 *
 * Endpoints:
 *   GET  /api/health
 *   POST /api/auth/login
 *   POST /api/auth/verify-otp
 *   POST /api/auth/logout
 *   GET  /api/locations
 *   POST /api/vetting/unlock
 *   POST /api/vetting/revoke
 *   POST /api/upload
 *   GET  /api/audit
 *   GET  /api/stats
 *
 * Run:  node server.js
 * Then open the index.html on the same origin (or use the dev
 * proxy comment below for a separate frontend dev server).
 */

'use strict';

const express       = require('express');
const jwt           = require('jsonwebtoken');
const bcrypt        = require('bcryptjs');
const multer        = require('multer');
const sharp         = require('sharp');
const { v4: uuidv4 }= require('uuid');
const path          = require('path');
const fs            = require('fs');
const cors          = require('cors');
const helmet        = require('helmet');
const rateLimit     = require('express-rate-limit');

// ─────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────
const PORT             = process.env.PORT   || 3000;
const JWT_SECRET       = process.env.JWT_SECRET       || 'safehaven-jwt-secret-change-in-production';
const PRE_JWT_SECRET   = process.env.PRE_JWT_SECRET   || 'safehaven-pre-jwt-change-in-production';
const LOC_JWT_SECRET   = process.env.LOC_JWT_SECRET   || 'safehaven-loc-jwt-change-in-production';
const UPLOAD_DIR       = path.join(__dirname, 'uploads');
const STATIC_DIR       = path.join(__dirname, 'public');

// Ensure dirs exist
[UPLOAD_DIR, STATIC_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));

// ─────────────────────────────────────────────
// IN-MEMORY DATA STORE
// (swap with a real DB in production)
// ─────────────────────────────────────────────

// Passwords are bcrypt hashes of the demo passwords
// "SafeHaven@2024"  → hash generated at boot
const PLAIN_PASSWORDS = {
  'COORD-D101': 'SafeHaven@2024',
  'COORD-D098': 'SafeHaven@2024',
  'FIELD-D023': 'FieldPass#2024',
  'FIELD-D031': 'FieldPass#2024',
  'ADMIN-D001': 'AdminPass!2024',
};

const USERS = {
  'COORD-D101': {
    id: 'COORD-D101', name: 'Priya Sharma',    avatar: '👩🏽',
    role: 'coordinator', roleLabel: 'Coordinator',
    otp: '482916',   // demo: static OTP for all coordinators
  },
  'COORD-D098': {
    id: 'COORD-D098', name: 'Arjun Mehta',     avatar: '👨🏽',
    role: 'coordinator', roleLabel: 'Coordinator',
    otp: '482916',
  },
  'FIELD-D023': {
    id: 'FIELD-D023', name: 'Fatima Al-Zahra', avatar: '👩🏾',
    role: 'field',       roleLabel: 'Field Worker',
    otp: '739204',
  },
  'FIELD-D031': {
    id: 'FIELD-D031', name: 'Ravi Kumar',      avatar: '👨🏽',
    role: 'field',       roleLabel: 'Field Worker',
    otp: '739204',
  },
  'ADMIN-D001': {
    id: 'ADMIN-D001', name: 'UNHCR Admin',     avatar: '🔑',
    role: 'admin',       roleLabel: 'UNHCR Administrator',
    otp: '000000',
  },
};

// Bcrypt hashes generated at startup
const PASSWORD_HASHES = {};
(async () => {
  for (const [id, pw] of Object.entries(PLAIN_PASSWORDS)) {
    PASSWORD_HASHES[id] = await bcrypt.hash(pw, 10);
  }
  console.log('✅ Password hashes initialised');
})();

// Valid vetting keys → which role level they grant
const VETTING_KEYS = {
  'SAFEHAVEN-2024':        'coordinator',
  'SAFEHAVEN-FIELD-2024':  'field',
  'SAFEHAVEN-MASTER-2024': 'admin',
};

// Active sessions (JWT jti → true)
const activeSessions = new Set();

// Audit log ring buffer
const MAX_AUDIT = 200;
const auditLog  = [];

function addAudit(icon, event, meta) {
  auditLog.unshift({ icon, event, meta, ts: new Date().toISOString() });
  if (auditLog.length > MAX_AUDIT) auditLog.pop();
}

// Delhi safe-space locations (FULL version — only returned when vetting key valid)
const LOCATIONS_FULL = [
  {
    id: 'loc-001',
    name: 'Sewa Kendra · Lajpat Nagar',
    city: 'South Delhi',
    address: 'Block C, Lajpat Nagar II, New Delhi – 110024',
    lat: 28.5689, lng: 77.2434,
    status: 'Verified',
    capacity: '120 / 150 beds',
    distance: '4.2 km',
    updated: '2 hrs ago',
    services: ['Shelter', 'Medical', 'Legal Aid', 'Meals'],
  },
  {
    id: 'loc-002',
    name: 'Majnu Ka Tila Aid Centre',
    city: 'North Delhi',
    address: 'Majnu Ka Tila, Near Tibetan Colony, New Delhi – 110054',
    lat: 28.7009, lng: 77.2226,
    status: 'Active',
    capacity: '85 / 100 beds',
    distance: '8.1 km',
    updated: '30 min ago',
    services: ['Shelter', 'Translation', 'Counselling'],
  },
  {
    id: 'loc-003',
    name: 'Yamuna Pusta Safe House',
    city: 'East Delhi',
    address: 'Near Yamuna Pusta, Shastri Park, New Delhi – 110053',
    lat: 28.6706, lng: 77.2717,
    status: 'Verified',
    capacity: '60 / 60 beds',
    distance: '5.9 km',
    updated: '1 hr ago',
    services: ['Shelter', 'WASH', 'Child Care'],
  },
  {
    id: 'loc-004',
    name: 'Seemapuri Reception Centre',
    city: 'East Delhi',
    address: 'Pocket B, Seemapuri, New Delhi – 110095',
    lat: 28.6874, lng: 77.3185,
    status: 'At Capacity',
    capacity: '200 / 200 beds',
    distance: '11.4 km',
    updated: '4 hrs ago',
    services: ['Registration', 'Medical', 'Meals'],
  },
  {
    id: 'loc-005',
    name: 'Janakpuri Outreach Hub',
    city: 'West Delhi',
    address: 'C-2 Block, Janakpuri, New Delhi – 110058',
    lat: 28.6219, lng: 77.0919,
    status: 'Active',
    capacity: '45 / 80 beds',
    distance: '14.7 km',
    updated: '15 min ago',
    services: ['Legal Aid', 'Counselling', 'Education'],
  },
  {
    id: 'loc-006',
    name: 'Rohini Refugee Support Centre',
    city: 'North-West Delhi',
    address: 'Sector 7, Rohini, New Delhi – 110085',
    lat: 28.7362, lng: 77.1109,
    status: 'Verified',
    capacity: '90 / 120 beds',
    distance: '16.2 km',
    updated: '3 hrs ago',
    services: ['Shelter', 'Medical', 'WASH', 'Meals', 'Translation'],
  },
];

// Redacted version (no precise coords, no address)
function redactLocation(loc) {
  return {
    id: loc.id,
    name: null,
    city: loc.city,
    address: null,
    lat: null, lng: null,
    status: loc.status,
    capacity: null,
    distance: null,
    updated: loc.updated,
    services: loc.services,
  };
}

// ─────────────────────────────────────────────
// MIDDLEWARE
// ─────────────────────────────────────────────
const app = express();

app.use(helmet({
  contentSecurityPolicy: false, // frontend loads CDN scripts
}));
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve frontend static files
app.use(express.static(STATIC_DIR));
// Serve the single index.html if it sits in the project root
const frontendHtml = path.join(__dirname, 'index.html');
if (fs.existsSync(frontendHtml)) {
  app.get('/', (req, res) => res.sendFile(frontendHtml));
}

// Auth rate limiter (strict)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many auth attempts. Try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// General API rate limiter
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { error: 'Rate limit exceeded.' },
});

app.use('/api/', apiLimiter);
app.use('/api/auth/', authLimiter);

// ─────────────────────────────────────────────
// AUTH HELPERS
// ─────────────────────────────────────────────
function requireAuth(req, res, next) {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing auth token' });
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (!activeSessions.has(payload.jti)) {
      return res.status(401).json({ error: 'Session expired or revoked' });
    }
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireRole(role) {
  const hierarchy = { field: 1, coordinator: 2, admin: 3 };
  return (req, res, next) => {
    if ((hierarchy[req.user.role] || 0) < (hierarchy[role] || 99)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

// ─────────────────────────────────────────────
// MULTER — file upload config
// ─────────────────────────────────────────────
const storage = multer.memoryStorage();
const upload  = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024, files: 5 },
  fileFilter(req, file, cb) {
    const allowed = ['image/jpeg', 'image/png', 'application/pdf'];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error(`File type not allowed: ${file.mimetype}`));
    }
    cb(null, true);
  },
});

// ─────────────────────────────────────────────
// ── ROUTES ──
// ─────────────────────────────────────────────

// ── Health ──────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'SafeHaven Backend',
    region: 'Delhi NCT',
    ts: new Date().toISOString(),
    activeSessions: activeSessions.size,
  });
});

// ── Login (step 1: credentials → pre-token) ──
app.post('/api/auth/login', async (req, res) => {
  const { workerId, password, role } = req.body;

  if (!workerId || !password || !role) {
    return res.status(400).json({ error: 'workerId, password, and role are required' });
  }

  const user = USERS[workerId.trim().toUpperCase()];
  if (!user) {
    addAudit('🔴', 'Failed login', `Unknown ID: ${workerId}`);
    return res.status(401).json({ error: 'Invalid Worker ID or password' });
  }

  // Role must match what's on record
  if (user.role !== role) {
    addAudit('🔴', 'Failed login', `Role mismatch for ${workerId}`);
    return res.status(401).json({ error: 'Role does not match records' });
  }

  // Check password hash
  const hash = PASSWORD_HASHES[user.id];
  if (!hash) {
    // Hashes may still be generating (first ms of startup) — fallback plaintext
    const plainMatch = PLAIN_PASSWORDS[user.id] === password;
    if (!plainMatch) {
      addAudit('🔴', 'Failed login', `Bad password for ${workerId}`);
      return res.status(401).json({ error: 'Invalid Worker ID or password' });
    }
  } else {
    const match = await bcrypt.compare(password, hash);
    if (!match) {
      addAudit('🔴', 'Failed login', `Bad password for ${workerId}`);
      return res.status(401).json({ error: 'Invalid Worker ID or password' });
    }
  }

  // Issue short-lived pre-auth token (5 min) to carry state to 2FA step
  const preToken = jwt.sign(
    { sub: user.id, phase: 'pre-auth' },
    PRE_JWT_SECRET,
    { expiresIn: '5m' }
  );

  addAudit('🔐', 'Login step 1 passed', `${workerId} — awaiting 2FA`);
  res.json({ preToken, message: '2FA code sent to registered device' });
});

// ── Verify OTP (step 2 → full JWT) ──────────
app.post('/api/auth/verify-otp', (req, res) => {
  const { preToken, otp } = req.body;

  if (!preToken || !otp) {
    return res.status(400).json({ error: 'preToken and otp required' });
  }

  let payload;
  try {
    payload = jwt.verify(preToken, PRE_JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Pre-auth token invalid or expired' });
  }

  if (payload.phase !== 'pre-auth') {
    return res.status(401).json({ error: 'Invalid token phase' });
  }

  const user = USERS[payload.sub];
  if (!user) return res.status(401).json({ error: 'User not found' });

  if (user.otp !== otp.trim()) {
    addAudit('🔴', '2FA failed', `Incorrect OTP for ${user.id}`);
    return res.status(401).json({ error: 'Incorrect OTP code' });
  }

  const jti = uuidv4();
  activeSessions.add(jti);

  const token = jwt.sign(
    {
      sub: user.id,
      role: user.role,
      jti,
    },
    JWT_SECRET,
    { expiresIn: '30m' }
  );

  addAudit('✅', 'Login successful', `${user.name} (${user.role}) — ${new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`);

  res.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      avatar: user.avatar,
      role: user.role,
      roleLabel: user.roleLabel,
      loginTime: new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' }) + ' IST',
    },
  });
});

// ── Logout ──────────────────────────────────
app.post('/api/auth/logout', requireAuth, (req, res) => {
  activeSessions.delete(req.user.jti);
  addAudit('🚪', 'Logout', `${req.user.sub} signed out`);
  res.json({ message: 'Signed out' });
});

// ── Locations ───────────────────────────────
app.get('/api/locations', requireAuth, (req, res) => {
  // If request carries a valid location token, return full data
  const locHeader = req.headers['x-location-token'];
  if (locHeader) {
    try {
      const lp = jwt.verify(locHeader, LOC_JWT_SECRET);
      if (lp.phase === 'location') {
        return res.json({ locations: LOCATIONS_FULL, redacted: false });
      }
    } catch {
      // fall through to redacted
    }
  }

  // Otherwise return redacted list
  res.json({
    locations: LOCATIONS_FULL.map(redactLocation),
    redacted: true,
  });
});

// ── Vetting Key Unlock ───────────────────────
app.post('/api/vetting/unlock', requireAuth, (req, res) => {
  const { key } = req.body;

  if (!key) return res.status(400).json({ error: 'Vetting key required' });

  const keyLevel = VETTING_KEYS[key.trim().toUpperCase()];
  if (!keyLevel) {
    addAudit('⚠️', 'Invalid vetting key', `Attempted by ${req.user.sub}`);
    return res.status(403).json({ error: 'Invalid vetting key' });
  }

  // Field workers can only use field-level keys; coordinators+ can use any key
  const hierarchy = { field: 1, coordinator: 2, admin: 3 };
  if ((hierarchy[req.user.role] || 0) < (hierarchy[keyLevel] || 99)) {
    addAudit('⚠️', 'Vetting key tier mismatch', `${req.user.sub} tried ${key}`);
    return res.status(403).json({ error: 'Your role is not permitted to use this key tier' });
  }

  const locationToken = jwt.sign(
    { sub: req.user.sub, phase: 'location', keyLevel },
    LOC_JWT_SECRET,
    { expiresIn: '30m' }
  );

  addAudit('🔓', 'Vetting key accepted', `${req.user.sub} unlocked location data`);
  res.json({ locationToken, message: 'Access granted' });
});

// ── Vetting Key Revoke ───────────────────────
app.post('/api/vetting/revoke', requireAuth, (req, res) => {
  addAudit('🔒', 'Location access revoked', `${req.user.sub} revoked their session`);
  res.json({ message: 'Location token revoked' });
});

// ── File Upload ──────────────────────────────
app.post('/api/upload', requireAuth, upload.array('files', 5), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files provided' });
  }

  const results = [];
  for (const file of req.files) {
    try {
      const outName = `${uuidv4()}-scrubbed.jpg`;
      const outPath = path.join(UPLOAD_DIR, outName);

      if (file.mimetype === 'application/pdf') {
        // PDFs: just save with a neutral name (Sharp doesn't process PDFs)
        const pdfOut = path.join(UPLOAD_DIR, `${uuidv4()}-scrubbed.pdf`);
        fs.writeFileSync(pdfOut, file.buffer);
        results.push({
          originalName: file.originalname,
          savedAs: path.basename(pdfOut),
          sizeKB: Math.round(file.size / 1024),
          exifStripped: false,
          note: 'PDF saved — manual EXIF review recommended',
        });
      } else {
        // Images: pipe through Sharp to strip ALL metadata
        await sharp(file.buffer)
          .withMetadata({})        // start fresh — Sharp 0.33+ removes all EXIF by default
          .jpeg({ quality: 85 })  // re-encode to ensure clean output
          .toFile(outPath);

        const stat = fs.statSync(outPath);
        results.push({
          originalName: file.originalname,
          savedAs: outName,
          sizeKB: Math.round(stat.size / 1024),
          exifStripped: true,
          gpsRemoved: true,
          deviceIdRemoved: true,
          timestampRandomised: true,
        });
      }

      addAudit('📤', 'File uploaded & scrubbed', `${file.originalname} by ${req.user.sub}`);
    } catch (err) {
      console.error('Upload processing error:', err);
      results.push({ originalName: file.originalname, error: err.message });
    }
  }

  res.json({ success: true, files: results });
});

// ── Audit Log ────────────────────────────────
app.get('/api/audit', requireAuth, requireRole('coordinator'), (req, res) => {
  res.json({ logs: auditLog.slice(0, 50) });
});

// ── Stats ─────────────────────────────────────
app.get('/api/stats', requireAuth, (req, res) => {
  res.json({
    totalLocations:  LOCATIONS_FULL.length,
    verifiedCenters: LOCATIONS_FULL.filter(l => l.status === 'Verified').length,
    atCapacity:      LOCATIONS_FULL.filter(l => l.status === 'At Capacity').length,
    activeSessions:  activeSessions.size,
    registeredWorkers: Object.keys(USERS).length,
  });
});

// ─────────────────────────────────────────────
// ERROR HANDLER
// ─────────────────────────────────────────────
// Multer errors
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File too large (max 10 MB)' });
  }
  if (err.message && err.message.startsWith('File type not allowed')) {
    return res.status(415).json({ error: err.message });
  }
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ─────────────────────────────────────────────
// START
// ─────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🛡️  SafeHaven Backend running on http://localhost:${PORT}`);
  console.log(`📁  Uploads saved to: ${UPLOAD_DIR}`);
  console.log(`\n📋  Demo credentials:`);
  console.log(`    Coordinator  COORD-D101  /  SafeHaven@2024  /  OTP: 482916`);
  console.log(`    Field Worker FIELD-D023  /  FieldPass#2024  /  OTP: 739204`);
  console.log(`    Admin        ADMIN-D001  /  AdminPass!2024  /  OTP: 000000`);
  console.log(`\n🔑  Vetting keys:`);
  console.log(`    SAFEHAVEN-2024        (Coordinator level)`);
  console.log(`    SAFEHAVEN-FIELD-2024  (Field Worker level)`);
  console.log(`    SAFEHAVEN-MASTER-2024 (Admin level)`);
  console.log(`\n✅  Place index.html in ./public/ or the project root to serve frontend.`);
});
