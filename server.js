const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');

const app = express();
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const UPLOAD_DIR = path.join(ROOT, 'public', 'uploads');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const PORT = Number(process.env.PORT || 3000);
const BASE_URL = (process.env.BASE_URL || '').replace(/\/$/, '');
const SESSION_SECRET = process.env.SESSION_SECRET;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  console.error('SESSION_SECRET is required and must be at least 32 characters.'); process.exit(1);
}
if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 12) {
  console.error('ADMIN_PASSWORD is required and must be at least 12 characters.'); process.exit(1);
}

const defaults = {
  businessName: 'Your Business',
  welcomeMessage: 'Thank you for visiting us. We would love to hear about your experience.',
  logo: '',
  googleReviewUrl: '',
  brandColor: '#172B4D',
  buttonColor: '#2563EB'
};
function readConfig() {
  try { return { ...defaults, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) }; }
  catch { return { ...defaults }; }
}
function saveConfig(config) {
  const temp = CONFIG_FILE + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(config, null, 2), { mode: 0o600 });
  fs.renameSync(temp, CONFIG_FILE);
}
function validGoogleReviewUrl(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    return host === 'google.com' || host.endsWith('.google.com') ||
      host === 'g.page' || host.endsWith('.g.page') ||
      host === 'goo.gl' || host.endsWith('.goo.gl') ||
      host === 'maps.app.goo.gl' || host === 'google.co.in' || host.endsWith('.google.co.in');
  } catch { return false; }
}
function safeColor(value, fallback) {
  return /^#[0-9a-fA-F]{6}$/.test(value || '') ? value : fallback;
}

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: { directives: {
  defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"], imgSrc: ["'self'", 'data:'],
  connectSrc: ["'self'"], objectSrc: ["'none'"], baseUri: ["'self'"], frameAncestors: ["'none'"]
} } }));
app.use(express.json({ limit: '30kb' }));
app.use(session({
  name: 'qgr.sid', secret: SESSION_SECRET, resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', maxAge: 8 * 60 * 60 * 1000 }
}));
app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }));

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: 'draft-7', legacyHeaders: false });
const upload = multer({ storage: multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (_req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex') + path.extname(file.originalname).toLowerCase())
}), limits: { fileSize: 2 * 1024 * 1024 }, fileFilter: (_req, file, cb) => {
  const allowed = ['image/png', 'image/jpeg', 'image/webp'];
  cb(allowed.includes(file.mimetype) ? null : new Error('Please upload a PNG, JPG, or WebP image.'), allowed.includes(file.mimetype));
} });

function requireAdmin(req, res, next) {
  if (req.session && req.session.admin === true) return next();
  return res.status(401).json({ error: 'Please sign in to continue.' });
}
function requireCsrf(req, res, next) {
  if (!req.session.csrf || req.get('x-csrf-token') !== req.session.csrf) return res.status(403).json({ error: 'Session expired. Refresh and try again.' });
  next();
}
app.get('/api/public-config', (_req, res) => {
  const c = readConfig();
  res.json({ businessName: c.businessName, welcomeMessage: c.welcomeMessage, logo: c.logo,
    brandColor: c.brandColor, buttonColor: c.buttonColor,
    googleReviewReady: validGoogleReviewUrl(c.googleReviewUrl) });
});
app.get('/api/google-review-link', (_req, res) => {
  const url = readConfig().googleReviewUrl;
  if (!validGoogleReviewUrl(url)) return res.status(503).json({ error: 'The business has not configured a valid Google review link yet.' });
  res.json({ url });
});
app.post('/api/admin/login', loginLimiter, async (req, res) => {
  const password = String(req.body?.password || '');
  // Compare against a bcrypt hash derived at process start to avoid storing a plaintext password.
  if (!(await bcrypt.compare(password, ADMIN_HASH))) return res.status(401).json({ error: 'Incorrect password. Please try again.' });
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: 'Unable to start a secure session.' });
    req.session.admin = true;
    req.session.csrf = crypto.randomBytes(24).toString('hex');
    res.json({ ok: true, csrf: req.session.csrf });
  });
});
app.get('/api/admin/session', requireAdmin, (req, res) => res.json({ ok: true, csrf: req.session.csrf }));
app.post('/api/admin/logout', requireAdmin, requireCsrf, (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get('/api/admin/config', requireAdmin, (req, res) => res.json(readConfig()));
app.put('/api/admin/config', requireAdmin, requireCsrf, (req, res) => {
  const body = req.body || {};
  const businessName = String(body.businessName || '').trim().slice(0, 100);
  const welcomeMessage = String(body.welcomeMessage || '').trim().slice(0, 240);
  const googleReviewUrl = String(body.googleReviewUrl || '').trim();
  if (!businessName) return res.status(400).json({ error: 'Please enter a business name.' });
  if (!validGoogleReviewUrl(googleReviewUrl)) return res.status(400).json({ error: 'Enter a valid HTTPS Google review URL (Google Maps, g.page, or Google review link).' });
  if (googleReviewUrl.length > 1000) return res.status(400).json({ error: 'The Google review URL is too long.' });
  const old = readConfig();
  const config = { ...old, businessName, welcomeMessage, googleReviewUrl,
    brandColor: safeColor(body.brandColor, defaults.brandColor),
    buttonColor: safeColor(body.buttonColor, defaults.buttonColor) };
  saveConfig(config);
  res.json({ ok: true, config });
});
app.post('/api/admin/logo', requireAdmin, requireCsrf, upload.single('logo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose a PNG, JPG, or WebP logo.' });
  const old = readConfig();
  if (old.logo && old.logo.startsWith('/uploads/')) {
    const oldPath = path.join(ROOT, 'public', old.logo.replace(/^\//, ''));
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
  }
  old.logo = '/uploads/' + req.file.filename;
  saveConfig(old);
  res.json({ ok: true, logo: old.logo });
});
app.get('/qr.png', async (req, res) => {
  const base = BASE_URL || `${req.protocol}://${req.get('host')}`;
  const landingUrl = `${base}/`;
  res.type('png').set('Content-Disposition', 'inline; filename="quick-google-review-qr.png"');
  try { res.send(await QRCode.toBuffer(landingUrl, { type: 'png', width: 1000, margin: 2, errorCorrectionLevel: 'H' })); }
  catch { res.status(500).json({ error: 'Could not generate the QR code.' }); }
});
app.get('/api/admin/qr.png', requireAdmin, async (req, res) => {
  const base = BASE_URL || `${req.protocol}://${req.get('host')}`;
  res.type('png').set('Content-Disposition', 'attachment; filename="quick-google-review-qr.png"');
  try { res.send(await QRCode.toBuffer(`${base}/`, { type: 'png', width: 1000, margin: 2, errorCorrectionLevel: 'H' })); }
  catch { res.status(500).json({ error: 'Could not generate the QR code.' }); }
});
app.get('/api/admin/qr-link', requireAdmin, (req, res) => {
  const base = BASE_URL || `${req.protocol}://${req.get('host')}`;
  res.json({ url: `${base}/`, qrUrl: `${base}/qr.png` });
});

const ADMIN_HASH = bcrypt.hashSync(ADMIN_PASSWORD, 12);
app.use((err, _req, res, _next) => {
  const message = err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE'
    ? 'Logo must be 2 MB or smaller.' : (err.message || 'Something went wrong.');
  res.status(400).json({ error: message });
});
app.listen(PORT, () => console.log(`Quick Google Review running on port ${PORT}`));
