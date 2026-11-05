// Passi City Community - back end (Node.js, no npm packages needed)
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const PORT = process.env.PORT || 3000;
const DATA = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const UPLOADS = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
const FILES = { '/': 'index.html', '/index.html': 'index.html', '/style.css': 'style.css', '/app.js': 'app.js', '/enhancements.js': 'enhancements.js' };
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };

let db = { users: [], bikes: [], sessions: {} };
try { db = { ...db, ...JSON.parse(fs.readFileSync(DATA, 'utf8')) }; } catch {}
const save = () => fs.writeFileSync(DATA, JSON.stringify(db, null, 2));

const hashPw = (pw, salt = crypto.randomBytes(16).toString('hex')) => salt + ':' + crypto.scryptSync(pw, salt, 64).toString('hex');
const checkPw = (pw, stored) => {
  if (!stored || typeof stored !== 'string' || !stored.includes(':')) return false;
  const [s, h] = stored.split(':');
  const digest = Buffer.from(h, 'hex');
  if (digest.length !== 64) return false;
  return crypto.timingSafeEqual(digest, crypto.scryptSync(pw, s, 64));
};
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
const readBody = req => new Promise((resolve, reject) => {
  let body = '', tooLarge = false;
  req.on('data', chunk => {
    body += chunk;
    if (body.length > 2_500_000) { tooLarge = true; reject(Object.assign(new Error('Request is too large.'), { status: 413 })); }
  });
  req.on('end', () => {
    if (tooLarge) return;
    try { resolve(JSON.parse(body || '{}')); } catch { reject(Object.assign(new Error('Invalid request body.'), { status: 400 })); }
  });
  req.on('error', reject);
});
const pick = (o, keys) => Object.fromEntries(keys.map(k => [k, String(o[k] ?? '').trim().slice(0, 100)]));
const BIKE_KEYS = ['owner', 'contact', 'brgy', 'brand', 'model', 'type', 'frame', 'size', 'group'];
const isAdmin = u => !!u && !!process.env.ADMIN_EMAIL && u.email.toLowerCase() === process.env.ADMIN_EMAIL.trim().toLowerCase();
const publicUser = u => ({ id: u.id, name: u.name, email: u.email, brgy: u.brgy, photoUrl: u.photoUrl || '', isAdmin: isAdmin(u) });

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    try { return await route(req, res, url.pathname.slice(4)); }
    catch (e) { if (e.status) return json(res, e.status, { error: e.message }); console.error(e); return json(res, 500, { error: 'Server error' }); }
  }
  const upload = url.pathname.match(/^\/uploads\/([a-f0-9-]+\.(?:jpg|png|webp))$/i);
  if (upload) {
    const file = path.join(UPLOADS, path.basename(upload[1]));
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end('Not found'); }
    const type = /\.png$/i.test(file) ? 'image/png' : /\.webp$/i.test(file) ? 'image/webp' : 'image/jpeg';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
    return fs.createReadStream(file).pipe(res);
  }
  const f = FILES[url.pathname];
  if (!f) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] + '; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
  fs.createReadStream(path.join(__dirname, f)).pipe(res);
}).listen(PORT, () => console.log('Passi City Community running at http://localhost:' + PORT));

async function route(req, res, p) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/, '');
  const user = db.users.find(u => u.id === db.sessions[token]);
  const m = req.method;

  if (p === '/stats' && m === 'GET') return json(res, 200, { members: db.users.length, bikes: db.bikes.length });

  if (p === '/register' && m === 'POST') {
    const b = await readBody(req), d = pick(b, ['name', 'email', 'brgy']), pw = String(b.pw || '');
    d.email = d.email.toLowerCase();
    if (!d.name || !/^\S+@\S+\.\S+$/.test(d.email) || !d.brgy || pw.length < 6)
      return json(res, 400, { error: 'Fill in all fields. Password needs 6+ characters.' });
    if (db.users.some(u => u.email === d.email)) return json(res, 409, { error: 'This email is already registered.' });
    const u = { id: crypto.randomUUID(), ...d, pw: hashPw(pw), createdAt: new Date().toISOString() };
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

  if (!user) return json(res, 401, { error: 'Please log in first.' });

  if (p === '/logout' && m === 'POST') { delete db.sessions[token]; save(); return json(res, 200, { ok: true }); }
  if (p === '/account' && m === 'GET') return json(res, 200, { user: publicUser(user) });

  if (p === '/account' && m === 'PATCH') {
    const b = await readBody(req), d = pick(b, ['name', 'email', 'brgy']);
    d.email = d.email.toLowerCase();
    if (!d.name || !/^\S+@\S+\.\S+$/.test(d.email) || !d.brgy) return json(res, 400, { error: 'Name, valid email and barangay are required.' });
    if (db.users.some(u => u.id !== user.id && u.email === d.email)) return json(res, 409, { error: 'This email is already in use.' });
    Object.assign(user, d); save();
    return json(res, 200, { user: publicUser(user) });
  }

  if (p === '/account/password' && m === 'POST') {
    const b = await readBody(req), current = String(b.currentPassword || ''), next = String(b.newPassword || '');
    if (!checkPw(current, user.pw)) return json(res, 400, { error: 'Current password is incorrect.' });
    if (next.length < 8) return json(res, 400, { error: 'New password must be at least 8 characters.' });
    user.pw = hashPw(next); save();
    return json(res, 200, { ok: true });
  }

  if (p === '/account/photo' && m === 'POST') {
    const b = await readBody(req), match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+=*)$/.exec(String(b.image || ''));
    if (!match) return json(res, 400, { error: 'Upload a JPEG, PNG or WebP image.' });
    const ext = { jpeg: 'jpg', png: 'png', webp: 'webp' }[match[1]], image = Buffer.from(match[2], 'base64');
    if (!image.length || image.length > 1_500_000) return json(res, 413, { error: 'Image must be smaller than 1.5 MB.' });
    const valid = ext === 'jpg' ? image[0] === 0xff && image[1] === 0xd8 && image[image.length - 2] === 0xff && image[image.length - 1] === 0xd9
      : ext === 'png' ? image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : image.toString('ascii', 0, 4) === 'RIFF' && image.toString('ascii', 8, 12) === 'WEBP';
    if (!valid) return json(res, 400, { error: 'The uploaded file is not a valid image.' });
    fs.mkdirSync(UPLOADS, { recursive: true });
    const filename = crypto.randomUUID() + '.' + ext, photoUrl = '/uploads/' + filename;
    fs.writeFileSync(path.join(UPLOADS, filename), image, { flag: 'wx' });
    const old = user.photoUrl;
    user.photoUrl = photoUrl; save();
    if (old && /^\/uploads\/[a-f0-9-]+\.(jpg|png|webp)$/i.test(old)) { try { fs.unlinkSync(path.join(UPLOADS, path.basename(old))); } catch {} }
    return json(res, 200, { user: publicUser(user) });
  }

  if (p === '/admin/users' && m === 'GET') {
    if (!isAdmin(user)) return json(res, 403, { error: 'Administrator access required.' });
    const members = db.users.map(u => ({
      id: u.id, name: u.name, email: u.email, brgy: u.brgy, photoUrl: u.photoUrl || '',
      createdAt: u.createdAt || null,
      bikes: db.bikes.filter(b => b.by === u.id).map(({ by, ...bike }) => bike),
    }));
    return json(res, 200, { users: members });
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
