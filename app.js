'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* =========================================================
   FRONT-END API CLIENT: talks to the Node.js back end (server.js)
   ========================================================= */
let TOKEN = localStorage.getItem('token');
let ME = (() => { try { return JSON.parse(localStorage.getItem('session')); } catch { return null; } })();
const CACHE = { bikes: [], stats: { members: 0, bikes: 0 } };
async function req(path, method = 'GET', body) {
  const r = await fetch('/api' + path, {
    method, headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && TOKEN && path !== '/login') { localStorage.removeItem('token'); localStorage.removeItem('session'); location.reload(); }
  if (!r.ok) throw new Error(d.error || 'Server error');
  return d;
}
const API = {
  async register(d) { return this.start(await req('/register', 'POST', d)); },
  async login(d) { return this.start(await req('/login', 'POST', d)); },
  start({ token, user }) { TOKEN = token; ME = user; localStorage.setItem('token', token); localStorage.setItem('session', JSON.stringify(user)); return user; },
  me: () => ME,
  async logout() { try { await req('/logout', 'POST'); } catch {} TOKEN = ME = null; localStorage.removeItem('token'); localStorage.removeItem('session'); },
  bikes: () => CACHE.bikes,
  stats: () => CACHE.stats,
  async refresh() {
    try { CACHE.stats = await req('/stats'); } catch {}
    if (TOKEN) try { CACHE.bikes = await req('/bikes'); } catch {}
  },
  saveBike: b => req('/bikes', 'POST', b),
  deleteBike: id => req('/bikes/' + id, 'DELETE'),
};

/* ---------- data ---------- */
const BARANGAYS = ['Agdahon', 'Alimodias', 'Bagacay', 'Buenavista', 'Dalicanan', 'Dolores', 'Magdungao', 'Mambunan',
  'Mulapula', 'Nagsulang', 'Pandan', 'Poblacion Ilawod', 'Poblacion Ilaya', 'Tagubong'];
const ROUTES = [
  { name: 'City Loop', level: 'Easy', color: '#1668e3', pts: [[11.1086, 122.6428], [11.1130, 122.6490], [11.1190, 122.6470], [11.1210, 122.6390], [11.1150, 122.6340], [11.1086, 122.6428]] },
  { name: 'Riverside Sprint', level: 'Moderate', color: '#0ea5a4', pts: [[11.1086, 122.6428], [11.1020, 122.6500], [11.0950, 122.6560], [11.0880, 122.6640], [11.0820, 122.6720]] },
  { name: 'San Enrique Compo', level: 'Hard', color: '#e0773a', pts: [[11.1086, 122.6428], [11.1000, 122.6330], [11.0920, 122.6250], [11.0860, 122.6160], [11.0790, 122.6090], [11.0720, 122.6020]] },
  { name: 'Agcararao Mountain View Resort', level: 'Moderate', color: '#7c4dff', pts: [[11.1086, 122.6428], [11.1180, 122.6560], [11.1280, 122.6650], [11.1370, 122.6720], [11.1450, 122.6800]] },
];
const STOPS = [
  { name: 'Gastion', type: 'Food', latlng: [11.1110, 122.6450] },
  { name: 'Local Stores', type: 'Store', latlng: [11.1140, 122.6410] },
  { name: 'Vulcanizing Shop', type: 'Bike repair', latlng: [11.1070, 122.6390] }
];
const FLOW = [
  ['Visit site', 'Anyone can see the community stats, the flowchart and the featured routes.'],
  ['Register / Log in', 'Create an account with your name, email, barangay and password. Passwords are hashed with SHA-256 before saving.'],
  ['Member dashboard', 'After login the Bike registry and Routes modules unlock.'],
  ['Register bike & owner', 'Save the owner profile, contact, barangay, brand, model, frame material, size and groupset. Edit or delete anytime.'],
  ['Browse routes', 'Pick a Passi City route on the Leaflet map and see its distance.'],
  ['Live ride', 'Start tracking: GPS draws your path and shows distance, time and speed.'],
];
const haversine = (a, b) => {
  const R = 6371, r = x => x * Math.PI / 180, dLa = r(b[0] - a[0]), dLo = r(b[1] - a[1]);
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const pathKm = p => p.slice(1).reduce((s, x, i) => s + haversine(p[i], x), 0);

/* ---------- UI helpers ---------- */
let toastT;
const toast = m => { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2800); };
const brgyOptions = BARANGAYS.map(b => `<option>${b}</option>`).join('');
$('#brgySel').innerHTML = $('#brgySel2').innerHTML = brgyOptions;

function countUp(el, to) {
  const from = +el.textContent || 0; if (from === to) return;
  const t0 = performance.now();
  (function f(t) { const p = Math.min((t - t0) / 700, 1); el.textContent = Math.round(from + (to - from) * p); if (p < 1) requestAnimationFrame(f); })(t0);
}
function refreshStats() { const s = API.stats(); countUp($('#sMembers'), s.members); countUp($('#sBikes'), s.bikes); }

/* ---------- flowchart ---------- */
$('#flowchart').innerHTML = FLOW.map((f, i) =>
  `<button class="node" data-i="${i}">${f[0]}</button>${i < FLOW.length - 1 ? '<span class="arrow">&rsaquo;</span>' : ''}`).join('');
$('#flowchart').addEventListener('click', e => {
  const n = e.target.closest('.node'); if (!n) return;
  $$('.node').forEach(x => x.classList.remove('on')); n.classList.add('on');
  $('#flowInfo').textContent = FLOW[n.dataset.i][1];
});

/* ---------- auth ---------- */
$$('.tab').forEach(t => t.onclick = () => {
  $$('.tab').forEach(x => x.classList.toggle('on', x === t));
  $('#regForm').hidden = t.dataset.t !== 'reg'; $('#logForm').hidden = t.dataset.t !== 'log';
});
const formData = f => Object.fromEntries(new FormData(f));
async function handleAuth(e, fn) {
  e.preventDefault();
  try { const s = await fn(formData(e.target)); e.target.reset(); applySession(s); toast('Welcome, ' + s.name.split(' ')[0] + '!'); $('#bikes').scrollIntoView(); }
  catch (err) { toast(err.message); }
}
$('#regForm').onsubmit = e => handleAuth(e, d => API.register(d));
$('#logForm').onsubmit = e => handleAuth(e, d => API.login(d));
$('#logoutBtn').onclick = async () => { await API.logout(); applySession(null); toast('Logged out.'); };
$$('a.gated').forEach(a => a.addEventListener('click', e => { if (!API.me()) { e.preventDefault(); $('#auth').scrollIntoView(); toast('Please log in first.'); } }));

function applySession(s) {
  $('#authForms').hidden = !!s; $('#welcome').hidden = !s; $('#logoutBtn').hidden = !s;
  $$('.locked').forEach(x => x.hidden = !s);
  $('#navAuth').hidden = !!s;
  if (s) {
    $('#welcome').innerHTML = `<h3>Hello, ${esc(s.name)}</h3><p class="note">Barangay ${esc(s.brgy)}. Your bike registry and routes are unlocked below.</p>`;
    $('#bikeForm [name=owner]').value ||= s.name; $('#bikeForm [name=brgy]').value = s.brgy;
    initMap();
  }
  API.refresh().then(() => { refreshStats(); if (API.me()) renderBikes(); });
}

/* ---------- bike registry ---------- */
const bf = $('#bikeForm');
bf.onsubmit = async e => {
  e.preventDefault();
  const d = formData(bf), edited = !!bf.dataset.id;
  try {
    await API.saveBike({ ...d, id: bf.dataset.id });
    await API.refresh(); resetBikeForm(); renderBikes(); refreshStats();
    toast(edited ? 'Bike updated.' : 'Bike saved.');
  } catch (err) { toast(err.message); }
};
function resetBikeForm() {
  bf.reset(); delete bf.dataset.id; $('#bikeFormTitle').textContent = 'Register a bike';
  $('#bikeSave').textContent = 'Save bike'; $('#bikeCancel').hidden = true;
  const s = API.me(); if (s) { bf.owner.value = s.name; bf.brgy.value = s.brgy; }
}
$('#bikeCancel').onclick = resetBikeForm;
$('#bikeSearch').oninput = renderBikes;
function renderBikes() {
  const q = $('#bikeSearch').value.toLowerCase();
  const list = API.bikes().filter(b => Object.values(b).join(' ').toLowerCase().includes(q));
  $('#bikeList').innerHTML = list.length ? list.map(b => `
    <article class="card">
      <h4>${esc(b.brand)} ${esc(b.model)}</h4>
      <span class="tag">${esc(b.type)}</span><span class="tag">${esc(b.frame)}</span>
      ${b.size ? `<span class="tag">${esc(b.size)}</span>` : ''}
      <p><b>Owner:</b> ${esc(b.owner)} (${esc(b.contact)})<br><b>Barangay:</b> ${esc(b.brgy)}
      ${b.group ? `<br><b>Groupset:</b> ${esc(b.group)}` : ''}</p>
      ${b.by === API.me().id ? `<div class="row"><button class="btn ghost" data-e="${b.id}">Edit</button><button class="btn ghost" data-d="${b.id}">Delete</button></div>` : ''}
    </article>`).join('') : '<div class="empty glass">No bikes found. Register the first one.</div>';
}
$('#bikeList').addEventListener('click', async e => {
  const del = e.target.dataset.d, ed = e.target.dataset.e;
  if (del && confirm('Delete this bike?')) {
    try { await API.deleteBike(del); await API.refresh(); renderBikes(); refreshStats(); toast('Bike deleted.'); } catch (err) { toast(err.message); }
  }
  if (ed) {
    const b = API.bikes().find(x => x.id === ed);
    Object.keys(b).forEach(k => { if (bf[k] && k !== 'id') bf[k].value = b[k]; });
    bf.dataset.id = ed; $('#bikeFormTitle').textContent = 'Edit bike'; $('#bikeSave').textContent = 'Update bike';
    $('#bikeCancel').hidden = false; bf.scrollIntoView({ behavior: 'smooth' });
  }
});

/* ---------- map & routes ---------- */
let map, layers = [], mapReady = false;
const ROUTING_URL = 'https://router.project-osrm.org/route/v1/driving/';
function asLonLat(points) { return points.map(([lat, lon]) => `${lon},${lat}`).join(';'); }
async function roadRoute(points) {
  const url = `${ROUTING_URL}${asLonLat(points)}?overview=full&geometries=geojson&steps=false`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Routing service returned ${response.status}`);
  const data = await response.json();
  if (data.code !== 'Ok' || !data.routes?.[0]?.geometry?.coordinates?.length) throw new Error('No road route found');
  // OSRM returns [longitude, latitude]; Leaflet uses [latitude, longitude].
  return data.routes[0].geometry.coordinates.map(([lon, lat]) => [lat, lon]);
}
function renderRouteList() {
  $('#routeList').innerHTML = ROUTES.map((r, i) =>
    `<div class="route" data-i="${i}"><b>${r.name}</b><span>${pathKm(r.pts).toFixed(1)} km</span><br><small>${r.level}</small></div>`).join('');
}
async function loadRoadRoutes() {
  await Promise.all(ROUTES.map(async (route, i) => {
    try {
      const points = await roadRoute(route.waypoints || route.pts);
      route.roadPts = points;
      route.pts = points;
      layers[i].setLatLngs(points);
      layers[i].setTooltipContent(`${route.name} · ${pathKm(points).toFixed(1)} km`);
    } catch (err) {
      // Keep the locally defined route visible if the routing service is unavailable.
      console.warn(`Could not road-route ${route.name}; showing its saved route instead.`, err);
    }
  }));
  renderRouteList();
}
function initMap() {
  if (mapReady) { setTimeout(() => map.invalidateSize(), 100); return; }
  mapReady = true;
  map = L.map('map').setView([11.1086, 122.6428], 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
  L.marker([11.1086, 122.6428]).addTo(map).bindPopup('Passi City Hall area (start point)');

  // Community stops: Gastion, local stores, and a vulcanizing / bike-repair shop.
  STOPS.forEach(s => {
    L.marker(s.latlng).addTo(map).bindPopup(`<b>${esc(s.name)}</b><br>Type: ${esc(s.type)}`);
  });

  renderRouteList();
  layers = ROUTES.map(r => L.polyline(r.pts, { color: r.color, weight: 5, opacity: .85 }).addTo(map)
    .bindTooltip(`${r.name} · ${pathKm(r.pts).toFixed(1)} km`));
  loadRoadRoutes();
  setTimeout(() => map.invalidateSize(), 150);
}
$('#routeList').addEventListener('click', e => {
  const el = e.target.closest('.route'); if (!el) return;
  $$('.route').forEach(x => x.classList.toggle('on', x === el));
  const l = layers[el.dataset.i]; layers.forEach(x => x.setStyle({ weight: 4, opacity: .35 })); l.setStyle({ weight: 7, opacity: 1 }).bringToFront();
  map.fitBounds(l.getBounds(), { padding: [40, 40] }); l.openTooltip();
});

/* ---------- live ride tracking ---------- */
let watch = null, track = null, me = null, pts = [], dist = 0, t0 = 0, timer = null;
const fmt = s => String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(Math.floor(s % 60)).padStart(2, '0');
$('#rideBtn').onclick = () => {
  if (watch !== null) return stopRide();
  if (!navigator.geolocation) return toast('Geolocation is not supported on this device.');
  pts = []; dist = 0; t0 = Date.now();
  track?.remove(); track = L.polyline([], { color: '#ff3b6b', weight: 6 }).addTo(map);
  $('#rideBtn').textContent = 'Stop ride'; $('#rideBtn').classList.add('stop');
  $('#rideNote').textContent = 'Waiting for GPS signal…';
  timer = setInterval(() => { $('#lTime').textContent = fmt((Date.now() - t0) / 1000); const h = (Date.now() - t0) / 3.6e6; $('#lSpeed').textContent = h ? (dist / h).toFixed(1) : '0.0'; }, 1000);
  watch = navigator.geolocation.watchPosition(p => {
    const c = [p.coords.latitude, p.coords.longitude];
    if (pts.length) { const d = haversine(pts[pts.length - 1], c); if (d < 0.003) return; dist += d; }
    pts.push(c); track.setLatLngs(pts); $('#lDist').textContent = dist.toFixed(2);
    me ? me.setLatLng(c) : me = L.circleMarker(c, { radius: 9, color: '#fff', weight: 3, fillColor: '#ff3b6b', fillOpacity: 1 }).addTo(map);
    map.setView(c, 16); $('#rideNote').textContent = 'Tracking live. Ride safe!';
  }, err => { toast('Location error: ' + err.message); stopRide(); }, { enableHighAccuracy: true, maximumAge: 2000 });
};
function stopRide() {
  navigator.geolocation.clearWatch(watch); watch = null; clearInterval(timer);
  $('#rideBtn').textContent = 'Start ride'; $('#rideBtn').classList.remove('stop');
  $('#rideNote').textContent = `Ride finished: ${dist.toFixed(2)} km in ${$('#lTime').textContent}.`;
}

/* ---------- boot ---------- */
applySession(API.me());
