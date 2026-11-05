// Passi City Community - back end (Node.js)
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const PORT = process.env.PORT || 3000;
const DATA = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'floresronel305@gmail.com').trim().toLowerCase();
const FILES = { '/': 'index.html', '/index.html': 'index.html', '/style.css': 'style.css', '/app.js': 'app.js', '/admin.js': 'admin.js', '/account.js': 'account.js' };
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
let db = { users: [], bikes: [], sessions: {}, passwordResets: {} };
try { db = { ...db, ...JSON.parse(fs.readFileSync(DATA, 'utf8')) }; } catch {}
db.passwordResets ||= {};
const save = () => fs.writeFileSync(DATA, JSON.stringify(db, null, 2));
const hashPw = (pw, salt = crypto.randomBytes(16).toString('hex')) => salt + ':' + crypto.scryptSync(pw, salt, 64).toString('hex');
const checkPw = (pw, stored) => {
  try {
    const [salt, hash] = stored.split(':');
    const expected = Buffer.from(hash, 'hex'), actual = crypto.scryptSync(pw, salt, 64);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch { return false; }
};
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
function readBody(req, maxBytes = 100000) {
  return new Promise((resolve, reject) => {
    let body = '', finished = false;
    req.on('data', chunk => {
      if (finished) return;
      body += chunk;
      if (body.length > maxBytes) {
        finished = true;
        const error = new Error('Request body is too large.'); error.statusCode = 413;
        reject(error); req.resume();
      }
    });
    req.on('end', () => {
      if (finished) return;
      try { resolve(JSON.parse(body || '{}')); } catch { resolve({}); }
    });
    req.on('error', error => { if (!finished) { finished = true; reject(error); } });
  });
}
const pick = (o, keys) => Object.fromEntries(keys.map(k => [k, String(o[k] ?? '').trim().slice(0, 100)]));
const BIKE_KEYS = ['owner', 'contact', 'brgy', 'brand', 'model', 'type', 'frame', 'size', 'group'];
const isAdmin = u => u?.email?.toLowerCase() === ADMIN_EMAIL;
const approvalStatus = u => isAdmin(u) ? 'approved' : (u.approvalStatus || 'approved');
const publicUser = u => ({ id: u.id, name: u.name, brgy: u.brgy, isAdmin: isAdmin(u), approvalStatus: approvalStatus(u), photoUrl: u.photoUrl || null });
const resetHash = token => crypto.createHash('sha256').update(token).digest('hex');

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    try { return await route(req, res, url.pathname.slice(4)); }
    catch (e) { console.error(e); return json(res, e.statusCode || 500, { error: e.statusCode ? e.message : 'Server error' }); }
  }
  const upload = url.pathname.match(/^\/uploads\/([a-f0-9-]+\.(?:jpg|png|webp))$/i);
  if (upload) {
    const file = path.join(UPLOAD_DIR, path.basename(upload[1]));
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end('Not found'); }
    const type = /\.png$/i.test(file) ? 'image/png' : /\.webp$/i.test(file) ? 'image/webp' : 'image/jpeg';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
    return fs.createReadStream(file).pipe(res);
  }
  const f = FILES[url.pathname];
  if (!f) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] + '; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
  if (f === 'index.html') {
    return fs.readFile(path.join(__dirname, f), 'utf8', (err, html) => {
      if (err) { res.writeHead(500); return res.end('Unable to load page'); }
      res.end(html.replace('</body>', '  <script src="/admin.js"></script>\n  <script src="/account.js"></script>\n</body>'));
    });
  }
  fs.createReadStream(path.join(__dirname, f)).pipe(res);
}).listen(PORT, () => console.log('Passi City Community running at http://localhost:' + PORT));

async function sendPasswordResetEmail(email, resetUrl) {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return false;
  const nodemailer = require('nodemailer');
  const port = Number(SMTP_PORT || 587);
  const transporter = nodemailer.createTransport({ host: SMTP_HOST, port, secure: String(process.env.SMTP_SECURE || port === 465) === 'true', auth: { user: SMTP_USER, pass: SMTP_PASS } });
  await transporter.sendMail({
    from: process.env.SMTP_FROM || SMTP_USER,
    to: email,
    subject: 'Reset your Passi City Community password',
    text: `We received a request to reset your password. This link expires in 30 minutes:\n\n${resetUrl}\n\nIf you did not request this, you can ignore this email.`,
    html: `<p>We received a request to reset your password.</p><p><a href="${resetUrl}">Reset your password</a></p><p>This link expires in 30 minutes. If you did not request this, you can ignore this email.</p>`,
  });
  return true;
}

async function route(req, res, p) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const user = db.users.find(u => u.id === db.sessions[token]);
  const m = req.method;

  if (p === '/stats' && m === 'GET') return json(res, 200, { members: db.users.length, bikes: db.bikes.length });

  if (p === '/register' && m === 'POST') {
    const b = await readBody(req), d = pick(b, ['name', 'email', 'brgy']), pw = String(b.pw || '');
    d.email = d.email.toLowerCase();
    if (!d.name || !/^\S+@\S+\.\S+$/.test(d.email) || !d.brgy || pw.length < 6)
      return json(res, 400, { error: 'Fill in all fields. Password needs 6+ characters.' });
    if (db.users.some(u => u.email === d.email)) return json(res, 409, { error: 'This email is already registered.' });
    const u = { id: crypto.randomUUID(), ...d, pw: hashPw(pw), approvalStatus: d.email === ADMIN_EMAIL ? 'approved' : 'pending' };
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

  if (p === '/password/forgot' && m === 'POST') {
    const b = await readBody(req), email = String(b.email || '').trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) return json(res, 400, { error: 'Enter a valid email address.' });
    const generic = 'If an account exists for that email, a password reset link will be sent.';
    const target = db.users.find(u => u.email === email);
    if (!target) return json(res, 200, { message: generic });
    const raw = crypto.randomBytes(32).toString('hex');
    db.passwordResets[resetHash(raw)] = { userId: target.id, expiresAt: Date.now() + 30 * 60 * 1000 };
    save();
    const base = (process.env.APP_URL || `http://${req.headers.host || 'localhost'}`).replace(/\/$/, '');
    const resetUrl = `${base}/?reset=${encodeURIComponent(raw)}&email=${encodeURIComponent(email)}#auth`;
    try {
      const sent = await sendPasswordResetEmail(email, resetUrl);
      if (!sent) {
        delete db.passwordResets[resetHash(raw)]; save();
        return json(res, 503, { error: 'Password reset email is not configured. Please contact the site administrator.' });
      }
    } catch (e) {
      delete db.passwordResets[resetHash(raw)]; save();
      console.error('Password reset email could not be sent:', e.message);
      return json(res, 503, { error: 'Could not send the reset email. Please try again later or contact the site administrator.' });
    }
    return json(res, 200, { message: generic });
  }

  if (p === '/password/reset' && m === 'POST') {
    const b = await readBody(req), raw = String(b.token || ''), email = String(b.email || '').trim().toLowerCase(), pw = String(b.password || '');
    if (pw.length < 8) return json(res, 400, { error: 'Password must be at least 8 characters.' });
    const key = resetHash(raw), record = db.passwordResets[key];
    if (!record || record.expiresAt < Date.now()) {
      if (record) { delete db.passwordResets[key]; save(); }
      return json(res, 400, { error: 'This reset link is invalid or expired. Request a new one.' });
    }
    const target = db.users.find(u => u.id === record.userId && u.email === email);
    if (!target) return json(res, 400, { error: 'This reset link is invalid or expired. Request a new one.' });
    target.pw = hashPw(pw);
    for (const [sessionToken, userId] of Object.entries(db.sessions)) if (userId === target.id) delete db.sessions[sessionToken];
    for (const [hash, entry] of Object.entries(db.passwordResets)) if (entry.userId === target.id) delete db.passwordResets[hash];
    save();
    return json(res, 200, { message: 'Password updated. Please log in with your new password.' });
  }

  if (!user) return json(res, 401, { error: 'Please log in first.' });
  if (p.startsWith('/admin/') && !isAdmin(user)) return json(res, 403, { error: 'Administrator access required.' });
  if (p === '/me' && m === 'GET') return json(res, 200, { user: publicUser(user) });
  if (p === '/logout' && m === 'POST') { delete db.sessions[token]; save(); return json(res, 200, { ok: true }); }

  // Profile settings and photo management remain available while membership approval is pending.
  if (p === '/settings' && m === 'PUT') {
    const b = await readBody(req), d = pick(b, ['name', 'brgy']);
    if (!d.name || !d.brgy) return json(res, 400, { error: 'Name and barangay are required.' });
    user.name = d.name; user.brgy = d.brgy; save();
    return json(res, 200, { user: publicUser(user) });
  }
  if (p === '/settings/password' && m === 'POST') {
    const b = await readBody(req), current = String(b.currentPassword || ''), next = String(b.newPassword || '');
    if (!checkPw(current, user.pw)) return json(res, 400, { error: 'Current password is incorrect.' });
    if (next.length < 8) return json(res, 400, { error: 'New password must be at least 8 characters.' });
    user.pw = hashPw(next); save();
    return json(res, 200, { message: 'Password changed successfully.' });
  }
  if (p === '/profile/photo' && m === 'POST') {
    const b = await readBody(req, Math.ceil(MAX_PHOTO_BYTES * 4 / 3) + 1000);
    const match = String(b.image || '').match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
    if (!match) return json(res, 400, { error: 'Upload a JPEG, PNG, or WebP image.' });
    const buffer = Buffer.from(match[2], 'base64');
    if (!buffer.length || buffer.length > MAX_PHOTO_BYTES) return json(res, 413, { error: 'Photo must be 2 MB or smaller.' });
    const valid = match[1] === 'jpeg' ? buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
      : match[1] === 'png' ? buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP';
    if (!valid) return json(res, 400, { error: 'Image data does not match its file type.' });
    const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
    const filename = `${crypto.randomUUID()}.${ext}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, filename), buffer, { flag: 'wx', mode: 0o644 });
    const oldPhoto = user.photoUrl;
    user.photoUrl = `/uploads/${filename}`; save();
    if (oldPhoto && /^\/uploads\/[a-f0-9-]+\.(?:jpg|png|webp)$/i.test(oldPhoto)) fs.promises.unlink(path.join(UPLOAD_DIR, path.basename(oldPhoto))).catch(() => {});
    return json(res, 200, { user: publicUser(user) });
  }
  if (p === '/profile/photo' && m === 'DELETE') {
    const oldPhoto = user.photoUrl; delete user.photoUrl; save();
    if (oldPhoto && /^\/uploads\/[a-f0-9-]+\.(?:jpg|png|webp)$/i.test(oldPhoto)) fs.promises.unlink(path.join(UPLOAD_DIR, path.basename(oldPhoto))).catch(() => {});
    return json(res, 200, { user: publicUser(user) });
  }

  if (!isAdmin(user) && approvalStatus(user) !== 'approved') {
    const message = approvalStatus(user) === 'rejected' ? 'Your membership request was not approved. Contact the administrator for help.' : 'Your membership is awaiting administrator approval.';
    return json(res, 403, { error: message, approvalStatus: approvalStatus(user) });
  }

  if (p === '/bikes' && m === 'GET') return json(res, 200, db.bikes);
  if (p === '/admin/users' && m === 'GET') {
    const users = db.users.map(u => ({ id: u.id, name: u.name, email: u.email, brgy: u.brgy, isAdmin: isAdmin(u), approvalStatus: approvalStatus(u), photoUrl: u.photoUrl || null }));
    return json(res, 200, users);
  }
  const approval = p.match(/^\/admin\/users\/([\w-]+)\/approval$/);
  if (approval && m === 'POST') {
    const target = db.users.find(u => u.id === approval[1]);
    if (!target) return json(res, 404, { error: 'Member not found.' });
    if (isAdmin(target)) return json(res, 403, { error: 'The administrator account cannot be changed here.' });
    const { status } = await readBody(req);
    if (!['approved', 'rejected'].includes(status)) return json(res, 400, { error: 'Choose approved or rejected.' });
    target.approvalStatus = status; save();
    return json(res, 200, { user: { id: target.id, approvalStatus: approvalStatus(target) } });
  }
  if (p === '/bikes' && m === 'POST') {
    const b = await readBody(req), d = pick(b, BIKE_KEYS);
    if (!d.owner || !d.contact || !d.brand || !d.model) return json(res, 400, { error: 'Owner, contact, brand and model are required.' });
    const i = db.bikes.findIndex(x => x.id === b.id);
    if (i > -1) {
      if (db.bikes[i].by !== user.id && !isAdmin(user)) return json(res, 403, { error: 'You can only edit your own bikes.' });
      db.bikes[i] = { ...db.bikes[i], ...d };
    } else db.bikes.push({ id: crypto.randomUUID(), by: user.id, ...d });
    save(); return json(res, 200, { ok: true });
  }
  const del = p.match(/^\/bikes\/([\w-]+)$/);
  if (del && m === 'DELETE') {
    const bike = db.bikes.find(x => x.id === del[1]);
    if (!bike) return json(res, 404, { error: 'Bike not found.' });
    if (bike.by !== user.id && !isAdmin(user)) return json(res, 403, { error: 'You can only delete your own bikes.' });
    db.bikes = db.bikes.filter(x => x.id !== bike.id); save(); return json(res, 200, { ok: true });
  }
  return json(res, 404, { error: 'Not found' });
}
