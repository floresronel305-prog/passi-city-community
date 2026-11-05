// Passi City Community - back end (Node.js, no npm packages needed)
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const PORT = process.env.PORT || 3000;
const DATA = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const FILES = { '/': 'index.html', '/index.html': 'index.html', '/style.css': 'style.css', '/app.js': 'app.js' };
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };

let db = { users: [], bikes: [], sessions: {} };
try { db = { ...db, ...JSON.parse(fs.readFileSync(DATA, 'utf8')) }; } catch {}
const save = () => fs.writeFileSync(DATA, JSON.stringify(db, null, 2));

const hashPw = (pw, salt = crypto.randomBytes(16).toString('hex')) => salt + ':' + crypto.scryptSync(pw, salt, 64).toString('hex');
const checkPw = (pw, stored) => {
  const [s, h] = stored.split(':');
  return crypto.timingSafeEqual(Buffer.from(h, 'hex'), crypto.scryptSync(pw, s, 64));
};
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
const readBody = req => new Promise(ok => {
  let b = ''; req.on('data', c => { b += c; if (b.length > 1e5) req.destroy(); });
  req.on('end', () => { try { ok(JSON.parse(b || '{}')); } catch { ok({}); } });
});
const pick = (o, keys) => Object.fromEntries(keys.map(k => [k, String(o[k] ?? '').trim().slice(0, 100)]));
const BIKE_KEYS = ['owner', 'contact', 'brgy', 'brand', 'model', 'type', 'frame', 'size', 'group'];
const publicUser = u => ({ id: u.id, name: u.name, brgy: u.brgy });

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    try { return await route(req, res, url.pathname.slice(4)); }
    catch (e) { console.error(e); return json(res, 500, { error: 'Server error' }); }
  }
  const f = FILES[url.pathname];
  if (!f) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] + '; charset=utf-8' });
  fs.createReadStream(path.join(__dirname, f)).pipe(res);
}).listen(PORT, () => console.log('Passi City Community running at http://localhost:' + PORT));

async function route(req, res, p) {
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

  if (!user) return json(res, 401, { error: 'Please log in first.' });

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
