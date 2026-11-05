'use strict';
(() => {
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const token = () => localStorage.getItem('token');
  async function featureRequest(path, method = 'GET', body) {
    const response = await fetch('/api' + path, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token() ? { Authorization: 'Bearer ' + token() } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Request failed.');
    return data;
  }
  const style = document.createElement('style');
  style.textContent = `
    #accountNav{display:none}.account-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px}
    .account-panel{padding:22px}.account-panel h3{margin-bottom:14px;color:var(--deep)}.account-panel form{margin-top:12px}
    .account-panel .btn{margin-top:4px}.profile-photo{width:88px;height:88px;border-radius:50%;object-fit:cover;background:#dcecff;border:3px solid white;box-shadow:var(--shadow)}
    .admin-user{padding:18px}.admin-user header{display:flex;align-items:center;gap:14px;margin-bottom:12px}.admin-user p{overflow-wrap:anywhere}
    .admin-bike{margin-top:10px;padding-top:10px;border-top:1px solid rgba(22,104,227,.14);font-size:.88rem;color:var(--muted)}
  `;
  document.head.append(style);

  const nav = document.querySelector('.nav nav');
  const anchor = document.createElement('a'); anchor.id = 'accountNav'; anchor.href = '#account'; anchor.textContent = 'Settings';
  nav.insertBefore(anchor, document.querySelector('#logoutBtn'));
  const section = document.createElement('section');
  section.id = 'account'; section.className = 'sec locked'; section.hidden = true;
  section.innerHTML = `
    <h2>Account settings</h2><p class="sub">Update your account and upload your cycling group/profile photo.</p>
    <div class="account-grid">
      <div class="glass account-panel"><h3>Profile settings</h3>
        <form id="profileSettings"><label>Full name<input name="name" required maxlength="100"></label>
          <label>Email<input name="email" type="email" required maxlength="100"></label>
          <label>Barangay<select name="brgy" id="settingsBrgy" required></select></label>
          <button class="btn primary">Save profile</button></form>
      </div>
      <div class="glass account-panel"><h3>Password reset</h3><p class="note">For security, enter your current password to set a new one.</p>
        <form id="passwordSettings"><label>Current password<input name="currentPassword" type="password" autocomplete="current-password" required></label>
          <label>New password<input name="newPassword" type="password" minlength="8" autocomplete="new-password" required></label>
          <label>Confirm new password<input name="confirmPassword" type="password" minlength="8" autocomplete="new-password" required></label>
          <button class="btn primary">Change password</button></form>
      </div>
      <div class="glass account-panel"><h3>Group / profile picture</h3><img id="accountPhoto" class="profile-photo" alt="Your uploaded group or profile photo" hidden>
        <p id="photoEmpty" class="note">No picture uploaded yet.</p><form id="photoSettings">
          <label>Choose a picture<input name="photo" type="file" accept="image/jpeg,image/png,image/webp" required></label>
          <p class="note">JPEG, PNG or WebP. The image is resized in your browser before upload.</p>
          <button class="btn primary">Upload picture</button></form>
      </div>
    </div>
    <div id="adminPanel" class="mt" hidden><h2>Admin · Member information</h2>
      <p class="sub">Private member profile and bike details. Passwords and password hashes are never shown.</p>
      <input id="adminSearch" class="search glass" type="search" placeholder="Search member name, email or barangay">
      <div id="adminUsers" class="cards"></div>
    </div>`;
  const authSection = document.querySelector('#auth');
  authSection.after(section);

  const barangaySelect = section.querySelector('#settingsBrgy');
  const sourceSelect = document.querySelector('#brgySel');
  if (sourceSelect) barangaySelect.innerHTML = sourceSelect.innerHTML;

  function updateUser(user) {
    const current = (() => { try { return JSON.parse(localStorage.getItem('session')) || {}; } catch { return {}; } })();
    const updated = { ...current, ...user };
    localStorage.setItem('session', JSON.stringify(updated));
    const session = document.querySelector('#welcome');
    if (session && window.applySession) window.applySession(updated);
    showAccount(updated);
  }
  function showAccount(user) {
    const loggedIn = !!user;
    anchor.style.display = loggedIn ? 'inline-block' : 'none';
    section.hidden = !loggedIn;
    if (!loggedIn) return;
    document.querySelectorAll('.locked').forEach(el => { el.hidden = false; });
    section.querySelector('[name=name]').value = user.name || '';
    section.querySelector('[name=email]').value = user.email || '';
    if ([...barangaySelect.options].some(option => option.value === user.brgy)) barangaySelect.value = user.brgy;
    const photo = section.querySelector('#accountPhoto'), empty = section.querySelector('#photoEmpty');
    photo.hidden = !user.photoUrl; empty.hidden = !!user.photoUrl;
    if (user.photoUrl) photo.src = user.photoUrl;
    section.querySelector('#adminPanel').hidden = !user.isAdmin;
    if (user.isAdmin) loadAdmin();
  }

  section.querySelector('#profileSettings').addEventListener('submit', async event => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try { const data = await featureRequest('/account', 'PATCH', values); updateUser(data.user); toast('Account settings saved.'); }
    catch (error) { toast(error.message); }
  });
  section.querySelector('#passwordSettings').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget, values = Object.fromEntries(new FormData(form));
    if (values.newPassword !== values.confirmPassword) return toast('New passwords do not match.');
    try { await featureRequest('/account/password', 'POST', values); form.reset(); toast('Password updated successfully.'); }
    catch (error) { toast(error.message); }
  });
  section.querySelector('#photoSettings').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget, file = form.elements.photo.files[0];
    if (!file) return toast('Choose an image first.');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return toast('Choose a JPEG, PNG or WebP image.');
    try {
      const image = await resizeImage(file), data = await featureRequest('/account/photo', 'POST', { image });
      updateUser(data.user); form.reset(); toast('Picture uploaded.');
    } catch (error) { toast(error.message); }
  });
  function resizeImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Could not read the selected image.'));
      reader.onload = () => {
        const image = new Image();
        image.onerror = () => reject(new Error('That image could not be opened.'));
        image.onload = () => {
          const scale = Math.min(1, 900 / Math.max(image.width, image.height));
          const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale));
          canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.82));
        };
        image.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  let adminMembers = [];
  async function loadAdmin() {
    try { const data = await featureRequest('/admin/users'); adminMembers = data.users || []; renderAdmin(); }
    catch (error) { section.querySelector('#adminUsers').textContent = error.message; }
  }
  function renderAdmin() {
    const query = section.querySelector('#adminSearch').value.trim().toLowerCase();
    const members = adminMembers.filter(member => [member.name, member.email, member.brgy].join(' ').toLowerCase().includes(query));
    section.querySelector('#adminUsers').innerHTML = members.length ? members.map(member => `
      <article class="card admin-user"><header>${member.photoUrl ? `<img class="profile-photo" src="${escapeHtml(member.photoUrl)}" alt="">` : '<span class="logo">P</span>'}
        <div><h3>${escapeHtml(member.name)}</h3><p>${escapeHtml(member.email)}</p></div></header>
        <p><b>Barangay:</b> ${escapeHtml(member.brgy)}</p><p><b>Registered:</b> ${escapeHtml(member.createdAt ? new Date(member.createdAt).toLocaleDateString() : 'Not recorded')}</p>
        <p><b>Bikes:</b> ${member.bikes.length}</p>${member.bikes.map(bike => `<div class="admin-bike"><b>${escapeHtml(bike.brand)} ${escapeHtml(bike.model)}</b><br>Owner: ${escapeHtml(bike.owner)} · Contact: ${escapeHtml(bike.contact)}<br>${escapeHtml(bike.brgy)}${bike.type ? ' · ' + escapeHtml(bike.type) : ''}</div>`).join('')}
      </article>`).join('') : '<div class="empty glass">No members found.</div>';
  }
  section.querySelector('#adminSearch').addEventListener('input', renderAdmin);

  const originalApplySession = window.applySession;
  if (typeof originalApplySession === 'function') {
    window.applySession = function (user) { originalApplySession(user); showAccount(user); };
  }
  try { showAccount(JSON.parse(localStorage.getItem('session'))); } catch { showAccount(null); }
})();
