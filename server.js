// Passi City Community - back end (Node.js)
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const PORT = process.env.PORT || 3000;
const DATA = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const FILES = { '/': 'index.html', '/index.html': 'index.html', '/reset-password': 'index.html', '/style.css': 'style.css', '/app.js': 'app.js', '/enhancements.js': 'enhancements.js' };
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };
const MAX_BODY = 3 * 1024 * 1024;

let db = { users: [], bikes: [], sessions: {}, passwordResets: {} };
try { db = { ...db, ...JSON.parse(fs.readFileSync(DATA, 'utf8')) }; } catch {}
const save = () => fs.writeFileSync(DATA, JSON.stringify(db, null, 2));
const hashPw = (pw, salt = crypto.randomBytes(16).toString('hex')) => salt + ':' + crypto.scryptSync(pw, salt, 64).toString('hex');
const checkPw = (pw, stored) => {
  try {
    const [s, h] = stored.split(':');
    const expected = Buffer.from(h, 'hex'), actual = crypto.scryptSync(pw, s, 64);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch { return false; }
};
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
const readBody = (req, limit = MAX_BODY) => new Promise((resolve, reject) => {
  let body = '', tooLarge = false;
  req.on('data', chunk => {
    if (tooLarge) return;
    body += chunk;
    if (Buffer.byteLength(body) > limit) { tooLarge = true; reject(Object.assign(new Error('Request too large'), { status: 413 })); }
  });
  req.on('end', () => {
    if (tooLarge) return;
    try { resolve(JSON.parse(body || '{}')); } catch { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); }
  });
  req.on('error', reject);
});
const pick = (o, keys) => Object.fromEntries(keys.map(k => [k, String(o[k] ?? '').trim().slice(0, 100)]));
const BIKE_KEYS = ['owner', 'contact', 'brgy', 'brand', 'model', 'type', 'frame', 'size', 'group'];
const publicUser = u => ({ id: u.id, name: u.name, email: u.email, brgy: u.brgy, photo: u.photo || '' });
const hashToken = token => crypto.createHash('sha256').update(token).digest('hex');
const emailPattern = /^\S+@\S+\.\S+$/;
const resetRate = new Map();
let mailer;
function getMailer() {
  if (mailer) return mailer;
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) return null;
  const nodemailer = require('nodemailer');
  mailer = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD.replace(/\s/g, '') },
  });
  return mailer;
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    try { return await route(req, res, url.pathname.slice(4), url); }
    catch (e) { console.error(e); return json(res, e.status || 500, { error: e.status ? e.message : 'Server error' }); }
  }
  const f = FILES[url.pathname];
  if (!f) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] + '; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
  fs.createReadStream(path.join(__dirname, f)).pipe(res);
}).listen(PORT, () => console.log('Passi City Community running at http://localhost:' + PORT));

async function route(req, res, p, url) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/, '');
  const user = db.users.find(u => u.id === db.sessions[token]);
  const m = req.method;

  if (p === '/stats' && m === 'GET') return json(res, 200, { members: db.users.length, bikes: db.bikes.length });

  if (p === '/register' && m === 'POST') {
    const b = await readBody(req), d = pick(b, ['name', 'email', 'brgy']), pw = String(b.pw || '');
    d.email = d.email.toLowerCase();
    if (!d.name || !emailPattern.test(d.email) || !d.brgy || pw.length < 6)
      return json(res, 400, { error: 'Fill in all fields. Password needs 6+ characters.' });
    if (db.users.some(u => u.email === d.email)) return json(res, 409, { error: 'This email is already registered.' });
    const u = { id: crypto.randomUUID(), ...d, pw: hashPw(pw), photo: '' };
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

  if (p === '/password-reset/request' && m === 'POST') {
    const b = await readBody(req), email = String(b.email || '').trim().toLowerCase();
    // Generic response for both registered and unknown addresses; throttle requests by address.
    const now = Date.now(), previous = resetRate.get(email) || 0;
    if (!emailPattern.test(email)) return json(res, 200, { message: 'If that email is registered, a reset link will be sent.' });
    if (now - previous < 60_000) return json(res, 200, { message: 'If that email is registered, a reset link will be sent.' });
    resetRate.set(email, now);
    const account = db.users.find(u => u.email === email);
    if (account) {
      const transport = getMailer();
      if (!transport) console.error('Password reset email not configured. Set GMAIL_USER and GMAIL_APP_PASSWORD.');
      else {
        const raw = crypto.randomBytes(32).toString('hex');
        const digest = hashToken(raw);
        db.passwordResets[digest] = { userId: account.id, expiresAt: now + 30 * 60 * 1000 };
        save();
        const baseUrl = (process.env.APP_URL || `http://${req.headers.host || 'localhost:' + PORT}`).replace(/\/$/, '');
        const resetUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(raw)}`;
        try {
          await transport.sendMail({
            from: process.env.GMAIL_USER,
            to: account.email,
            subject: 'Reset your Passi City Community password',
            text: `Hello ${account.name},\n\nUse this link within 30 minutes to set a new password:\n${resetUrl}\n\nIf you did not request this, you can ignore this email.`,
          });
        } catch (e) {
          delete db.passwordResets[digest]; save(); console.error('Password reset email failed:', e.message);
        }
      }
    }
    return json(res, 200, { message: 'If that email is registered, a reset link will be sent.' });
  }

  if (p === '/password-reset/complete' && m === 'POST') {
    const b = await readBody(req), raw = String(b.token || ''), pw = String(b.password || '');
    if (pw.length < 8) return json(res, 400, { error: 'New password must be at least 8 characters.' });
    if (!/^[a-f0-9]{64}$/.test(raw)) return json(res, 400, { error: 'This reset link is invalid or expired.' });
    const digest = hashToken(raw), reset = db.passwordResets[digest];
    if (!reset || reset.expiresAt < Date.now()) {
      delete db.passwordResets[digest];
      return json(res, 400, { error: 'This reset link is invalid or expired.' });
    }
    const account = db.users.find(u => u.id === reset.userId);
    if (!account) { delete db.passwordResets[digest]; save(); return json(res, 400, { error: 'This reset link is invalid or expired.' }); }
    account.pw = hashPw(pw);
    delete db.passwordResets[digest];
    for (const [session, userId] of Object.entries(db.sessions)) if (userId === account.id) delete db.sessions[session];
    save();
    return json(res, 200, { message: 'Password updated. Please log in with your new password.' });
  }

  if (!user) return json(res, 401, { error: 'Please log in first.' });

  if (p === '/logout' && m === 'POST') { delete db.sessions[token]; save(); return json(res, 200, { ok: true }); }
  if (p === '/profile' && m === 'GET') return json(res, 200, { user: publicUser(user) });
  if (p === '/profile' && m === 'PUT') {
    const b = await readBody(req);
    const name = String(b.name || '').trim().slice(0, 100);
    const brgy = String(b.brgy || '').trim().slice(0, 100);
    if (!name || !brgy) return json(res, 400, { error: 'Name and barangay are required.' });
    if (b.photo !== undefined) {
      const photo = String(b.photo || '');
      if (photo && (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(photo) || photo.length > 2_800_000))
        return json(res, 400, { error: 'Choose a PNG, JPEG, or WebP image smaller than 2 MB.' });
      user.photo = photo;
    }
    user.name = name; user.brgy = brgy; save();
    return json(res, 200, { user: publicUser(user) });
  }
  if (p === '/password' && m === 'PUT') {
    const b = await readBody(req), current = String(b.currentPassword || ''), next = String(b.newPassword || '');
    if (!checkPw(current, user.pw)) return json(res, 400, { error: 'Current password is incorrect.' });
    if (next.length < 8) return json(res, 400, { error: 'New password must be at least 8 characters.' });
    user.pw = hashPw(next); save();
    return json(res, 200, { ok: true });
  }
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
