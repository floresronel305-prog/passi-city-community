'use strict';
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const API_BASE = '/api';
  const token = () => localStorage.getItem('token');
  async function call(path, method = 'POST', payload = {}) {
    const response = await fetch(API_BASE + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token() ? { Authorization: 'Bearer ' + token() } : {}) },
      body: method === 'GET' ? undefined : JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Request failed.');
    return data;
  }
  function tell(message) {
    const toast = $('#toast');
    if (toast) { toast.textContent = message; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 3200); }
    else alert(message);
  }
  const barangays = () => [...($('#brgySel')?.options || [])].map(o => o.value);
  const profilePicture = photo => photo ? `<img class="profile-photo" src="${photo}" alt="Profile photo">` : '<span class="profile-photo-placeholder" aria-hidden="true">👤</span>';

  function addSettings() {
    const welcome = $('#welcome');
    if (!welcome || $('#accountSettings')) return;
    welcome.insertAdjacentHTML('beforeend', `
      <details id="accountSettings" class="settings-panel">
        <summary>Account settings</summary>
        <div class="settings-content">
          <div class="profile-preview" id="profilePreview"></div>
          <form id="profileForm">
            <label>Profile photo (PNG, JPEG or WebP, max 2 MB)
              <input id="profilePhoto" type="file" accept="image/png,image/jpeg,image/webp">
            </label>
            <label>Full name<input name="name" maxlength="100" required></label>
            <label>Barangay<select name="brgy" id="settingsBrgy" required></select></label>
            <button class="btn primary" type="submit">Save profile</button>
          </form>
          <hr>
          <h4>Change password</h4>
          <form id="changePasswordForm">
            <label>Current password<input name="currentPassword" type="password" autocomplete="current-password" required></label>
            <label>New password (at least 8 characters)<input name="newPassword" type="password" minlength="8" autocomplete="new-password" required></label>
            <button class="btn ghost" type="submit">Update password</button>
          </form>
        </div>
      </details>`);
    const select = $('#settingsBrgy');
    select.innerHTML = barangays().map(b => `<option value="${esc(b)}">${esc(b)}</option>`).join('');
    const session = JSON.parse(localStorage.getItem('session') || 'null');
    $('#profileForm [name=name]').value = session?.name || '';
    $('#profileForm [name=brgy]').value = session?.brgy || '';
    $('#profilePreview').innerHTML = `${profilePicture(session?.photo)}<span>${esc(session?.name || '')}</span>`;
    $('#profilePhoto').addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) {
        e.target.value = ''; return tell('Choose a PNG, JPEG, or WebP image smaller than 2 MB.');
      }
      const reader = new FileReader();
      reader.onload = () => { const preview = $('#profilePreview'); preview.innerHTML = `${profilePicture(reader.result)}<span>${esc(session?.name || '')}</span>`; };
      reader.readAsDataURL(file);
    });
    $('#profileForm').addEventListener('submit', async e => {
      e.preventDefault();
      const form = new FormData(e.currentTarget), data = { name: form.get('name'), brgy: form.get('brgy') };
      const file = $('#profilePhoto').files[0];
      try {
        if (file) data.photo = await new Promise((resolve, reject) => {
          const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file);
        });
        const result = await call('/profile', 'PUT', data);
        localStorage.setItem('session', JSON.stringify(result.user));
        if (typeof API !== 'undefined') { /* API session is refreshed on reload below. */ }
        $('#profilePreview').innerHTML = `${profilePicture(result.user.photo)}<span>${esc(result.user.name)}</span>`;
        $('#welcome h3').textContent = `Hello, ${result.user.name}`;
        $('#welcome .note').textContent = `Barangay ${result.user.brgy}. Your bike registry and routes are unlocked below.`;
        $('#bikeForm [name=owner]').value = result.user.name;
        $('#bikeForm [name=brgy]').value = result.user.brgy;
        tell('Profile settings saved. Reload the page to refresh your session display.');
      } catch (err) { tell(err.message); }
    });
    $('#changePasswordForm').addEventListener('submit', async e => {
      e.preventDefault();
      const values = Object.fromEntries(new FormData(e.currentTarget));
      try { await call('/password', 'PUT', values); e.currentTarget.reset(); tell('Password updated.'); }
      catch (err) { tell(err.message); }
    });
  }

  function addResetControls() {
    const login = $('#logForm');
    if (login && !$('#forgotPassword')) {
      login.insertAdjacentHTML('beforeend', '<button type="button" class="text-button" id="forgotPassword">Forgot password?</button>');
      $('#forgotPassword').addEventListener('click', () => {
        const email = login.elements.email.value.trim() || prompt('Enter the email address for your account:');
        if (email) call('/password-reset/request', 'POST', { email }).then(r => tell(r.message)).catch(err => tell(err.message));
      });
    }
  }

  function resetPage() {
    const tokenValue = new URLSearchParams(location.search).get('token');
    if (!location.pathname.endsWith('/reset-password') || !tokenValue) return;
    const auth = $('#authForms');
    if (!auth) return;
    auth.innerHTML = `
      <h3>Choose a new password</h3>
      <form id="resetPasswordForm" class="reset-form">
        <label>New password (at least 8 characters)<input name="password" type="password" minlength="8" autocomplete="new-password" required></label>
        <button class="btn primary" type="submit">Reset password</button>
      </form>`;
    $('#resetPasswordForm').addEventListener('submit', async e => {
      e.preventDefault();
      try {
        const password = new FormData(e.currentTarget).get('password');
        const result = await call('/password-reset/complete', 'POST', { token: tokenValue, password });
        history.replaceState(null, '', '/');
        tell(result.message);
        $('#authForms').innerHTML = '<div class="tabs"><button class="tab on" data-t="reg">Register</button><button class="tab" data-t="log">Log in</button></div><p>Password reset complete. Please log in with your new password.</p><a class="btn primary" href="/#auth">Go to login</a>';
      } catch (err) { tell(err.message); }
    });
  }

  function start() {
    addResetControls();
    if (localStorage.getItem('token')) addSettings();
    resetPage();
  }
  document.addEventListener('DOMContentLoaded', start);
  // app.js currently invokes its boot synchronously before this file is loaded.
  if (document.readyState !== 'loading') setTimeout(start, 0);
})();
