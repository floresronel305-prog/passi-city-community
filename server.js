// Passi City Community - back end (Node.js, no npm packages needed)
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
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
  if (!stored || typeof stored !== 'string' || !stored.includes(':')) return false;
  const [s, h] = stored.split(':');
  const expected = crypto.scryptSync(pw, s, 64), actual = Buffer.from(h, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
};
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
const readBody = req => new Promise(ok => {
  let b = ''; req.on('data', c => { b += c; if (b.length > 1e5) req.destroy(); });
  req.on('end', () => { try { ok(JSON.parse(b || '{}')); } catch { ok({}); } });
});
const pick = (o, keys) => Object.fromEntries(keys.map(k => [k, String(o[k] ?? '').trim().slice(0, 100)]));
const BIKE_KEYS = ['owner', 'contact', 'brgy', 'brand', 'model', 'type', 'frame', 'size', 'group'];
const publicUser = u => ({ id: u.id, name: u.name, email: u.email, brgy: u.brgy });
const validEmail = email => /^\S+@\S+\.\S+$/.test(email);
const resetHash = token => crypto.createHash('sha256').update(token).digest('hex');

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    try { return await route(req, res, url.pathname.slice(4), url); }
    catch (e) { console.error(e); return json(res, 500, { error: 'Server error' }); }
  }
  const f = FILES[url.pathname];
  if (!f) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] + '; charset=utf-8' });
  const stream = fs.createReadStream(path.join(__dirname, f));
  if (f === 'index.html') {
    let html = '';
    stream.setEncoding('utf8'); stream.on('data', chunk => { html += chunk; });
    stream.on('end', () => res.end(html.replace('</body>', '<script src="/enhancements.js"></script>\n</body>')));
    stream.on('error', () => { if (!res.headersSent) res.writeHead(500); res.end('Could not load page'); });
  } else stream.pipe(res);
}).listen(PORT, () => console.log('Passi City Community running at http://localhost:' + PORT));

async function route(req, res, p, url) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/, '');
  const user = db.users.find(u => u.id === db.sessions[token]);
  const m = req.method;

  if (p === '/stats' && m === 'GET') return json(res, 200, { members: db.users.length, bikes: db.bikes.length });

  if (p === '/register' && m === 'POST') {
    const b = await readBody(req), d = pick(b, ['name', 'email', 'brgy']), pw = String(b.pw || '');
    d.email = d.email.toLowerCase();
    if (!d.name || !validEmail(d.email) || !d.brgy || pw.length < 6)
      return json(res, 400, { error: 'Fill in all fields. Password needs 6+ characters.' });
    if (db.users.some(u => u.email === d.email)) return json(res, 409, { error: 'This email is already registered.' });
    const u = { id: crypto.randomUUID(), ...d, pw: hashPw(pw) };
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

  // Email-based reset uses Resend. Configure RESEND_API_KEY, RESET_FROM_EMAIL, and APP_ORIGIN.
  if (p === '/forgot-password' && m === 'POST') {
    const b = await readBody(req), email = String(b.email || '').trim().toLowerCase();
    const generic = { message: 'If that email is registered, password-reset instructions will be sent.' };
    const u = db.users.find(x => x.email === email);
    if (u && process.env.RESEND_API_KEY && process.env.RESET_FROM_EMAIL && process.env.APP_ORIGIN) {
      const raw = crypto.randomBytes(32).toString('hex'), hash = resetHash(raw);
      const resetUrl = new URL('/', process.env.APP_ORIGIN);
      resetUrl.searchParams.set('reset', raw); resetUrl.hash = 'auth';
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: process.env.RESET_FROM_EMAIL, to: [u.email], subject: 'Reset your Passi City Community password',
          html: `<p>We received a request to reset your password.</p><p><a href="${resetUrl.toString()}">Choose a new password</a></p><p>This link expires in 30 minutes. If you did not request this, you can ignore this email.</p>` })
      });
      if (response.ok) { db.passwordResets[hash] = { userId: u.id, expiresAt: Date.now() + 30 * 60 * 1000 }; save(); }
      else console.error('Password reset email provider returned:', response.status, await response.text());
    } else if (u) console.warn('Password reset email is not configured; set RESEND_API_KEY, RESET_FROM_EMAIL, and APP_ORIGIN.');
    return json(res, 200, generic);
  }

  if (p === '/reset-password' && m === 'POST') {
    const b = await readBody(req), pw = String(b.password || ''), raw = String(b.token || '');
    if (pw.length < 8) return json(res, 400, { error: 'Password must be at least 8 characters.' });
    const hash = resetHash(raw), record = db.passwordResets[hash];
    if (!record || record.expiresAt < Date.now()) {
      delete db.passwordResets[hash]; save();
      return json(res, 400, { error: 'This reset link is invalid or expired. Request a new one.' });
    }
    const u = db.users.find(x => x.id === record.userId);
    if (!u) { delete db.passwordResets[hash]; save(); return json(res, 400, { error: 'This reset link is invalid or expired. Request a new one.' }); }
    u.pw = hashPw(pw); delete db.passwordResets[hash];
    for (const [session, userId] of Object.entries(db.sessions)) if (userId === u.id) delete db.sessions[session];
    save(); return json(res, 200, { ok: true });
  }

  if (!user) return json(res, 401, { error: 'Please log in first.' });

  if (p === '/logout' && m === 'POST') { delete db.sessions[token]; save(); return json(res, 200, { ok: true }); }
  if (p === '/account' && m === 'GET') return json(res, 200, { user: publicUser(user) });
  if (p === '/account' && m === 'PUT') {
    const b = await readBody(req), d = pick(b, ['name', 'email', 'brgy']); d.email = d.email.toLowerCase();
    if (!d.name || !validEmail(d.email) || !d.brgy) return json(res, 400, { error: 'Enter a valid name, email, and barangay.' });
    if (db.users.some(x => x.id !== user.id && x.email === d.email)) return json(res, 409, { error: 'That email is already in use.' });
    Object.assign(user, d); save(); return json(res, 200, { user: publicUser(user) });
  }
  if (p === '/account/password' && m === 'PUT') {
    const b = await readBody(req), current = String(b.currentPassword || ''), next = String(b.newPassword || '');
    if (!checkPw(current, user.pw)) return json(res, 400, { error: 'Current password is incorrect.' });
    if (next.length < 8) return json(res, 400, { error: 'New password must be at least 8 characters.' });
    user.pw = hashPw(next); save(); return json(res, 200, { ok: true });
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
    const bike = db.bikes.find(x => x.id === del[1]);
    if (!bike) return json(res, 404, { error: 'Bike not found.' });
    if (bike.by !== user.id) return json(res, 403, { error: 'You can only delete your own bikes.' });
    db.bikes = db.bikes.filter(x => x.id !== bike.id); save(); return json(res, 200, { ok: true });
  }
  return json(res, 404, { error: 'Not found' });
}
