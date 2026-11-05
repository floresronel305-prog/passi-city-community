// Passi City Community - dependency-free Node.js backend.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PORT = Number(process.env.PORT) || 3000;
const DATA = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const FILES = { '/': 'index.html', '/index.html': 'index.html', '/style.css': 'style.css', '/enhancements.css': 'enhancements.css', '/app.js': 'app.js', '/enhancements.js': 'enhancements.js' };
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
let db = { users: [], bikes: [], sessions: {}, groupPhoto: null };
try { db = { ...db, ...JSON.parse(fs.readFileSync(DATA, 'utf8')) }; } catch {}
const save = () => fs.writeFileSync(DATA, JSON.stringify(db, null, 2));
const hashPw = (pw, salt = crypto.randomBytes(16).toString('hex')) => salt + ':' + crypto.scryptSync(pw, salt, 64).toString('hex');
const checkPw = (pw, stored) => {
  try { const [salt, hash] = stored.split(':'); const expected = Buffer.from(hash, 'hex'); const actual = crypto.scryptSync(pw, salt, 64); return expected.length === actual.length && crypto.timingSafeEqual(expected, actual); }
  catch { return false; }
};
const json = (res, code, obj, headers = {}) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }); res.end(JSON.stringify(obj)); };
function readBody(req, limit = 100 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '', tooLarge = false;
    req.on('data', chunk => { if (tooLarge) return; body += chunk; if (Buffer.byteLength(body) > limit) { tooLarge = true; reject(Object.assign(new Error('Request body is too large.'), { status: 413 })); } });
    req.on('end', () => { if (tooLarge) return; try { resolve(JSON.parse(body || '{}')); } catch { reject(Object.assign(new Error('Invalid JSON body.'), { status: 400 })); } });
    req.on('error', reject);
  });
}
const pick = (obj, keys) => Object.fromEntries(keys.map(k => [k, String(obj[k] ?? '').trim().slice(0, 100)]));
const publicUser = u => ({ id: u.id, name: u.name, brgy: u.brgy });
const resetRequests = new Map();
function allowReset(ip) {
  const now = Date.now(), old = resetRequests.get(ip) || { start: now, count: 0 };
  if (now - old.start > 15 * 60 * 1000) { old.start = now; old.count = 0; }
  old.count++; resetRequests.set(ip, old); return old.count <= 8;
}
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    try { return await route(req, res, url.pathname.slice(4), url); }
    catch (err) { if (res.headersSent) return; if (err.status) return json(res, err.status, { error: err.message }); console.error(err); return json(res, 500, { error: 'Server error' }); }
  }
  const file = FILES[url.pathname];
  if (!file) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': (MIME[path.extname(file)] || 'application/octet-stream') + '; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
  fs.createReadStream(path.join(__dirname, file)).on('error', () => { if (!res.headersSent) res.writeHead(404); res.end('Not found'); }).pipe(res);
}).listen(PORT, () => console.log(`Passi City Community running at http://localhost:${PORT}`));

async function route(req, res, p, url) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const user = db.users.find(u => u.id === db.sessions[token]);
  const method = req.method;

  if (p === '/stats' && method === 'GET') return json(res, 200, { members: db.users.length, bikes: db.bikes.length });
  if (p === '/group-photo' && method === 'GET') {
    if (!db.groupPhoto) return json(res, 200, { photo: null });
    return json(res, 200, { photo: `data:${db.groupPhoto.mime};base64,${db.groupPhoto.data}` });
  }
  if (p === '/forgot-password' && method === 'POST') {
    if (!allowReset(req.socket.remoteAddress || 'unknown')) return json(res, 429, { error: 'Too many requests. Please try again later.' });
    const body = await readBody(req), email = String(body.email || '').trim().toLowerCase();
    const account = db.users.find(u => u.email === email);
    let resetUrl;
    if (account) {
      const rawToken = crypto.randomBytes(32).toString('hex');
      account.resetTokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      account.resetExpires = Date.now() + 30 * 60 * 1000;
      save();
      const origin = process.env.APP_BASE_URL || `http://${req.headers.host || `localhost:${PORT}`}`;
      resetUrl = `${origin.replace(/\/$/, '')}/?reset=${encodeURIComponent(rawToken)}#auth`;
      // In production, deliver this URL through a configured mail provider. Until then, the link is available in server logs.
      console.info(`Password reset link for ${account.email}: ${resetUrl}`);
    }
    const response = { message: 'If an account exists for that email, a password reset link has been created.' };
    if (account && process.env.NODE_ENV !== 'production') response.resetUrl = resetUrl;
    return json(res, 200, response);
  }
  if (p === '/reset-password' && method === 'POST') {
    const body = await readBody(req), raw = String(body.token || ''), password = String(body.password || '');
    if (password.length < 6) return json(res, 400, { error: 'Password must be at least 6 characters.' });
    if (!/^[a-f0-9]{64}$/i.test(raw)) return json(res, 400, { error: 'This reset link is invalid or expired.' });
    const digest = crypto.createHash('sha256').update(raw).digest('hex');
    const account = db.users.find(u => u.resetTokenHash && u.resetTokenHash === digest && u.resetExpires > Date.now());
    if (!account) return json(res, 400, { error: 'This reset link is invalid or expired.' });
    account.pw = hashPw(password); delete account.resetTokenHash; delete account.resetExpires;
    for (const [session, userId] of Object.entries(db.sessions)) if (userId === account.id) delete db.sessions[session];
    save(); return json(res, 200, { ok: true, message: 'Password updated. Log in using your new password.' });
  }

  if (p === '/register' && method === 'POST') {
    const body = await readBody(req), data = pick(body, ['name', 'email', 'brgy']), password = String(body.pw || '');
    data.email = data.email.toLowerCase();
    if (!data.name || !/^\S+@\S+\.\S+$/.test(data.email) || !data.brgy || password.length < 6) return json(res, 400, { error: 'Fill in all fields. Password needs 6+ characters.' });
    if (db.users.some(u => u.email === data.email)) return json(res, 409, { error: 'This email is already registered.' });
    const account = { id: crypto.randomUUID(), ...data, pw: hashPw(password) }, newToken = crypto.randomBytes(24).toString('hex');
    db.users.push(account); db.sessions[newToken] = account.id; save();
    return json(res, 201, { token: newToken, user: publicUser(account) });
  }
  if (p === '/login' && method === 'POST') {
    const body = await readBody(req), email = String(body.email || '').toLowerCase().trim(), account = db.users.find(u => u.email === email);
    if (!account || !checkPw(String(body.pw || ''), account.pw)) return json(res, 401, { error: 'Wrong email or password.' });
    const newToken = crypto.randomBytes(24).toString('hex'); db.sessions[newToken] = account.id; save();
    return json(res, 200, { token: newToken, user: publicUser(account) });
  }
  if (!user) return json(res, 401, { error: 'Please log in first.' });

  if (p === '/logout' && method === 'POST') { delete db.sessions[token]; save(); return json(res, 200, { ok: true }); }
  if (p === '/me' && method === 'GET') return json(res, 200, { user: publicUser(user) });
  if (p === '/profile' && method === 'PUT') {
    const body = await readBody(req), name = String(body.name || '').trim().slice(0, 100), brgy = String(body.brgy || '').trim().slice(0, 100);
    if (!name || !brgy) return json(res, 400, { error: 'Name and barangay are required.' });
    user.name = name; user.brgy = brgy; save(); return json(res, 200, { user: publicUser(user) });
  }
  if (p === '/password' && method === 'PUT') {
    const body = await readBody(req), current = String(body.currentPassword || ''), next = String(body.newPassword || '');
    if (!checkPw(current, user.pw)) return json(res, 400, { error: 'Current password is incorrect.' });
    if (next.length < 6) return json(res, 400, { error: 'New password must be at least 6 characters.' });
    user.pw = hashPw(next);
    for (const [session, userId] of Object.entries(db.sessions)) if (userId === user.id && session !== token) delete db.sessions[session];
    save(); return json(res, 200, { ok: true });
  }
  if (p === '/group-photo' && method === 'PUT') {
    const body = await readBody(req, 3 * 1024 * 1024), match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(body.photo || ''));
    if (!match) return json(res, 400, { error: 'Choose a valid JPG, PNG, or WebP image.' });
    const bytes = Buffer.from(match[2], 'base64');
    if (!bytes.length || bytes.length > MAX_PHOTO_BYTES) return json(res, 413, { error: 'Photo must be smaller than 2 MB.' });
    // Verify the file signature instead of trusting the browser-supplied MIME type.
    const signatures = { 'image/jpeg': bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff, 'image/png': bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])), 'image/webp': bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' };
    if (!signatures[match[1]]) return json(res, 400, { error: 'The image file does not match its format.' });
    db.groupPhoto = { mime: match[1], data: bytes.toString('base64'), updatedAt: Date.now(), by: user.id };
    save(); return json(res, 200, { ok: true });
  }
  if (p === '/group-photo' && method === 'DELETE') { db.groupPhoto = null; save(); return json(res, 200, { ok: true }); }
  if (p === '/bikes' && method === 'GET') return json(res, 200, db.bikes);
  if (p === '/bikes' && method === 'POST') {
    const body = await readBody(req), data = pick(body, ['owner', 'contact', 'brgy', 'brand', 'model', 'type', 'frame', 'size', 'group']);
    if (!data.owner || !data.contact || !data.brand || !data.model) return json(res, 400, { error: 'Owner, contact, brand and model are required.' });
    const i = db.bikes.findIndex(b => b.id === body.id);
    if (i > -1) { if (db.bikes[i].by !== user.id) return json(res, 403, { error: 'You can only edit your own bikes.' }); db.bikes[i] = { ...db.bikes[i], ...data }; }
    else db.bikes.push({ id: crypto.randomUUID(), by: user.id, ...data });
    save(); return json(res, 200, { ok: true });
  }
  const del = p.match(/^\/bikes\/([\w-]+)$/);
  if (del && method === 'DELETE') {
    const bike = db.bikes.find(b => b.id === del[1]);
    if (!bike) return json(res, 404, { error: 'Bike not found.' });
    if (bike.by !== user.id) return json(res, 403, { error: 'You can only delete your own bikes.' });
    db.bikes = db.bikes.filter(b => b.id !== bike.id); save(); return json(res, 200, { ok: true });
  }
  return json(res, 404, { error: 'Not found' });
}
