// Passi City Community - back end
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const nodemailer = require('nodemailer');
const PORT = process.env.PORT || 3000;
const DATA = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const FILES = { '/': 'index.html', '/index.html': 'index.html', '/style.css': 'style.css', '/app.js': 'app.js', '/enhancements.js': 'enhancements.js' };
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };

let db = { users: [], bikes: [], sessions: {}, passwordResets: {} };
try { db = { ...db, ...JSON.parse(fs.readFileSync(DATA, 'utf8')) }; } catch {}
db.passwordResets ||= {};
const save = () => fs.writeFileSync(DATA, JSON.stringify(db, null, 2));

const hashPw = (pw, salt = crypto.randomBytes(16).toString('hex')) => salt + ':' + crypto.scryptSync(pw, salt, 64).toString('hex');
const checkPw = (pw, stored) => {
  const [s, h] = stored.split(':');
  return crypto.timingSafeEqual(Buffer.from(h, 'hex'), crypto.scryptSync(pw, s, 64));
};
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
const readBody = (req, max = 1e5) => new Promise((resolve, reject) => {
  let body = '', tooLarge = false;
  req.on('data', chunk => {
    if (tooLarge) return;
    body += chunk;
    if (body.length > max) { tooLarge = true; body = ''; }
  });
  req.on('end', () => {
    if (tooLarge) { const e = new Error('Request too large'); e.status = 413; return reject(e); }
    try { resolve(JSON.parse(body || '{}')); } catch { resolve({}); }
  });
  req.on('error', reject);
});
const pick = (o, keys) => Object.fromEntries(keys.map(k => [k, String(o[k] ?? '').trim().slice(0, 100)]));
const BIKE_KEYS = ['owner', 'contact', 'brgy', 'brand', 'model', 'type', 'frame', 'size', 'group'];
const publicUser = u => ({ id: u.id, name: u.name, brgy: u.brgy, photo: u.photo || null });
const resetAttempts = new Map();
const resetHash = token => crypto.createHash('sha256').update(token).digest('hex');

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    try { return await route(req, res, url.pathname.slice(4), url); }
    catch (e) {
      console.error(e);
      if (!res.headersSent) return json(res, e.status || 500, { error: e.status === 413 ? 'Request too large.' : 'Server error' });
      return;
    }
  }
  const f = FILES[url.pathname];
  if (!f) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] + '; charset=utf-8' });
  fs.createReadStream(path.join(__dirname, f)).pipe(res);
}).listen(PORT, () => console.log('Passi City Community running at http://localhost:' + PORT));

async function route(req, res, p, url) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const user = db.users.find(u => u.id === db.sessions[token]);
  const m = req.method;

  if (p === '/stats' && m === 'GET') return json(res, 200, { members: db.users.length, bikes: db.bikes.length });

  if (p === '/register' && m === 'POST') {
    const b = await readBody(req), d = pick(b, ['name', 'email', 'brgy']), pw = String(b.pw || '');
    d.email = d.email.toLowerCase();
    if (!d.name || !/^\S+@\S+\.\S+$/.test(d.email) || !d.brgy || pw.length < 6)
      return json(res, 400, { error: 'Fill in all fields. Password needs 6+ characters.' });
    if (db.users.some(u => u.email === d.email)) return json(res, 409, { error: 'This email is already registered.' });
    const u = { id: crypto.randomUUID(), ...d, pw: hashPw(pw), photo: null };
    const t = crypto.randomBytes(24).toString('hex');
    db.users.push(u); db.sessions[t] = u.id; save();
    return json(res, 201, { token: t, user: publicUser(u) });
  }

  if (p === '/login' && m === 'POST') {
    const b = await readBody(req), email = String(b.email || '').toLowerCase().trim();
    const u = db.users.find(x => x.email === email);
    if (!u || !checkPw(String(b.pw || ''), u.pw)) return json(res, 401, { error: 'Wrong email or password.' });
    const t = crypto.randomBytes(24).toString('hex'); db.sessions[t] = u.id; save();
    return json(res, 200, { token: t, user: publicUser(u) });
  }

  if (p === '/forgot-password' && m === 'POST') {
    const b = await readBody(req);
    const email = String(b.email || '').toLowerCase().trim();
    const windowMs = 15 * 60 * 1000, now = Date.now(), ip = req.socket.remoteAddress || 'unknown';
    const prior = (resetAttempts.get(ip) || []).filter(t => now - t < windowMs);
    if (prior.length >= 5) return json(res, 429, { error: 'Too many requests. Please try again later.' });
    prior.push(now); resetAttempts.set(ip, prior);

    const smtpUser = process.env.SMTP_USER, smtpPass = process.env.SMTP_PASS;
    const siteUrl = process.env.APP_URL;
    if (!smtpUser || !smtpPass || !siteUrl) {
      return json(res, 503, { error: 'Password reset email is not configured yet. Please contact the website administrator.' });
    }
    const account = db.users.find(u => u.email === email);
    if (!account) return json(res, 200, { message: 'If that email is registered, a password-reset link will be sent.' });

    const rawToken = crypto.randomBytes(32).toString('hex');
    const key = resetHash(rawToken);
    db.passwordResets[key] = { userId: account.id, expiresAt: now + 30 * 60 * 1000 };
    save();
    try {
      const port = Number(process.env.SMTP_PORT || 465);
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com', port, secure: port === 465,
        auth: { user: smtpUser, pass: smtpPass },
      });
      const resetUrl = new URL('/', siteUrl);
      resetUrl.searchParams.set('reset', rawToken);
      await transporter.sendMail({
        from: process.env.SMTP_FROM || smtpUser,
        to: account.email,
        subject: 'Reset your Passi City Community password',
        text: `We received a request to reset your password. Open this link within 30 minutes: ${resetUrl.href}\n\nIf you did not request this, you can ignore this email.`,
        html: `<p>We received a request to reset your Passi City Community password.</p><p><a href="${resetUrl.href}">Reset my password</a></p><p>This link expires in 30 minutes. If you did not request this, you can ignore this email.</p>`,
      });
    } catch (e) {
      delete db.passwordResets[key]; save();
      throw e;
    }
    return json(res, 200, { message: 'If that email is registered, a password-reset link will be sent.' });
  }

  if (p === '/reset-password' && m === 'POST') {
    const b = await readBody(req), rawToken = String(b.token || ''), pw = String(b.password || '');
    if (pw.length < 6) return json(res, 400, { error: 'Password must be at least 6 characters.' });
    const key = resetHash(rawToken), reset = db.passwordResets[key];
    if (!reset || reset.expiresAt < Date.now()) {
      if (reset) { delete db.passwordResets[key]; save(); }
      return json(res, 400, { error: 'This reset link is invalid or expired. Please request a new one.' });
    }
    const account = db.users.find(u => u.id === reset.userId);
    if (!account) { delete db.passwordResets[key]; save(); return json(res, 400, { error: 'This reset link is invalid or expired.' }); }
    account.pw = hashPw(pw);
    delete db.passwordResets[key];
    for (const [session, userId] of Object.entries(db.sessions)) if (userId === account.id) delete db.sessions[session];
    save();
    return json(res, 200, { message: 'Password updated. Please log in with your new password.' });
  }

  if (!user) return json(res, 401, { error: 'Please log in first.' });

  if (p === '/account' && m === 'PUT') {
    const b = await readBody(req, 800000);
    const name = String(b.name || '').trim().slice(0, 100);
    const brgy = String(b.brgy || '').trim().slice(0, 100);
    const photo = b.photo === null ? null : b.photo;
    if (!name || !brgy) return json(res, 400, { error: 'Name and barangay are required.' });
    if (photo !== null && (typeof photo !== 'string' || photo.length > 700000 || !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(photo)))
      return json(res, 400, { error: 'Please upload a valid JPG, PNG, or WebP photo under 500 KB.' });
    user.name = name; user.brgy = brgy; user.photo = photo;
    save();
    return json(res, 200, { user: publicUser(user) });
  }

  if (p === '/account/password' && m === 'POST') {
    const b = await readBody(req);
    if (!checkPw(String(b.currentPassword || ''), user.pw)) return json(res, 400, { error: 'Current password is incorrect.' });
    const newPassword = String(b.newPassword || '');
    if (newPassword.length < 6) return json(res, 400, { error: 'New password must be at least 6 characters.' });
    user.pw = hashPw(newPassword); save();
    return json(res, 200, { message: 'Password changed successfully.' });
  }

  if (p === '/logout' && m === 'POST') { delete db.sessions[token]; save(); return json(res, 200, { ok: true }); }
  if (p === '/bikes' && m === 'GET') return json(res, 200, db.bikes);

  if (p === '/bikes' && m === 'POST') {
    const b = await readBody(req), d = pick(b, BIKE_KEYS);
    if (!d.owner || !d.contact || !d.brand || !d.model) return json(res, 400, { error: 'Owner, contact, brand and model are required.' });
    const i = db.bikes.findIndex(x => x.id === b.id);
    if (i > -1) {
      if (db.bikes[i].by !== user.id) return json(res, 403, { error: 'You can only edit your own bikes.' });
      db.bikes[i] = { ...db.bikes[i], ...d };
    } else db.bikes.push({ id: crypto.randomUUID(), by: user.id, ...d });
    save(); return json(res, 200, { ok: true });
  }

  const del = p.match(/^\/bikes\/([\w-]+)$/);
  if (del && m === 'DELETE') {
    const b = db.bikes.find(x => x.id === del[1]);
    if (!b) return json(res, 404, { error: 'Bike not found.' });
    if (b.by !== user.id) return json(res, 403, { error: 'You can only delete your own bikes.' });
    db.bikes = db.bikes.filter(x => x.id !== b.id); save(); return json(res, 200, { ok: true });
  }
  return json(res, 404, { error: 'Not found' });
}
