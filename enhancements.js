'use strict';
(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const injectStyle = () => {
    const style = document.createElement('style');
    style.textContent = `
      .bg::before{content:"";position:absolute;inset:0;background:linear-gradient(115deg,rgba(5,22,45,.62),rgba(8,52,101,.18)),url("https://images.unsplash.com/photo-1517649763962-0c623066013b?auto=format&fit=crop&w=2200&q=85") center 48%/cover no-repeat;opacity:.34;transform:scale(1.02)}
      .bg .orb,.bg .grid,.bg .routes{opacity:.42}.nav{gap:12px}.nav nav{justify-content:flex-end}
      .settings-panel{max-width:760px;padding:26px;margin-top:20px}.settings-grid{display:grid;grid-template-columns:1fr 1fr;gap:22px}.settings-grid form{padding:20px;border:1px solid rgba(22,104,227,.16);border-radius:16px;background:rgba(255,255,255,.48)}
      .settings-panel h3{margin-bottom:14px;color:var(--deep)}.form-note{font-size:.85rem;color:var(--muted);margin:0 0 14px}.text-link{display:inline-block;margin-top:12px;color:var(--blue);font-weight:600;text-decoration:none}.text-link:hover{text-decoration:underline}
      #forgotPanel,#resetPanel{margin-top:16px}.settings-heading{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:16px}
      @media(max-width:700px){.settings-grid{grid-template-columns:1fr}.settings-panel{padding:18px}.nav{border-radius:20px;align-items:flex-start}.nav nav{gap:2px}.nav nav a{padding:5px 8px}}
    `;
    document.head.append(style);
  };
  injectStyle();

  const nav = $('.nav nav');
  if (nav && !$('#settingsNav')) {
    const link = document.createElement('a'); link.id = 'settingsNav'; link.href = '#settings'; link.className = 'gated'; link.textContent = 'Settings'; link.hidden = true;
    nav.insertBefore(link, $('#logoutBtn'));
  }
  const main = $('main');
  if (main && !$('#settings')) {
    const section = document.createElement('section'); section.id = 'settings'; section.className = 'sec locked'; section.hidden = true;
    section.innerHTML = `
      <h2>Account settings</h2><p class="sub">Update your profile and password.</p>
      <div class="glass settings-panel"><div class="settings-grid">
        <form id="profileSettings"><h3>Profile</h3>
          <label>Full name<input name="name" required maxlength="100"></label>
          <label>Email<input name="email" type="email" required maxlength="100"></label>
          <label>Barangay<select name="brgy" id="settingsBrgy" required></select></label>
          <button class="btn primary">Save profile</button>
        </form>
        <form id="passwordSettings"><h3>Change password</h3>
          <label>Current password<input name="currentPassword" type="password" autocomplete="current-password" required></label>
          <label>New password<input name="newPassword" type="password" minlength="8" autocomplete="new-password" required></label>
          <label>Confirm new password<input name="confirmPassword" type="password" minlength="8" autocomplete="new-password" required></label>
          <button class="btn primary">Update password</button>
        </form>
      </div></div>`;
    main.append(section);
    const source = $('#brgySel'); const select = $('#settingsBrgy');
    if (source && select) select.innerHTML = source.innerHTML;
  }
  const login = $('#logForm');
  if (login && !$('#forgotLink')) {
    const link = document.createElement('a'); link.href = '#forgot'; link.id = 'forgotLink'; link.className = 'text-link'; link.textContent = 'Forgot password?';
    login.append(link);
    const panel = document.createElement('div'); panel.id = 'forgotPanel'; panel.hidden = true;
    panel.innerHTML = `<form id="forgotForm"><p class="form-note">Enter your account email. If it is registered, we will email a secure reset link.</p><label>Email<input name="email" type="email" autocomplete="email" required></label><button class="btn primary">Send reset link</button><button type="button" class="btn ghost" id="cancelForgot">Cancel</button></form>`;
    login.insertAdjacentElement('afterend', panel);
  }
  const authCard = $('.auth');
  if (authCard && !$('#resetPanel')) {
    const panel = document.createElement('div'); panel.id = 'resetPanel'; panel.hidden = true;
    panel.innerHTML = `<form id="resetForm"><h3>Choose a new password</h3><p class="form-note">Reset links expire after 30 minutes and can be used once.</p><label>New password<input name="password" type="password" minlength="8" autocomplete="new-password" required></label><label>Confirm password<input name="confirm" type="password" minlength="8" autocomplete="new-password" required></label><button class="btn primary">Reset password</button></form>`;
    authCard.append(panel);
  }

  const token = () => localStorage.getItem('token');
  async function api(path, method = 'GET', body) {
    const response = await fetch('/api' + path, { method, headers: { 'Content-Type': 'application/json', ...(token() ? { Authorization: 'Bearer ' + token() } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Request failed.');
    return data;
  }
  const notify = message => {
    const toast = $('#toast');
    if (toast) { toast.textContent = message; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 3500); }
    else alert(message);
  };
  function syncSession(user) {
    localStorage.setItem('session', JSON.stringify(user));
    const welcome = $('#welcome');
    if (welcome) welcome.innerHTML = `<h3>Hello, ${esc(user.name)}</h3><p class="note">Barangay ${esc(user.brgy)}. Your bike registry and routes are unlocked below.</p>`;
    const owner = $('#bikeForm [name=owner]'); if (owner) owner.value = user.name;
    const brgy = $('#bikeForm [name=brgy]'); if (brgy) brgy.value = user.brgy;
  }
  async function loadProfile() {
    if (!token()) return;
    try {
      const { user } = await api('/account');
      const form = $('#profileSettings'); if (!form) return;
      for (const key of ['name', 'email', 'brgy']) form.elements[key].value = user[key] || '';
    } catch (error) { notify(error.message); }
  }
  const settingsLink = $('#settingsNav');
  if (settingsLink) settingsLink.addEventListener('click', event => {
    if (!token()) { event.preventDefault(); $('#auth')?.scrollIntoView(); notify('Please log in first.'); return; }
    loadProfile();
  });

  $('#profileSettings')?.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget, values = Object.fromEntries(new FormData(form));
    try {
      const { user } = await api('/account', 'PUT', values); syncSession(user); notify('Profile saved.');
    } catch (error) { notify(error.message); }
  });
  $('#passwordSettings')?.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget, values = Object.fromEntries(new FormData(form));
    if (values.newPassword !== values.confirmPassword) return notify('New passwords do not match.');
    try {
      await api('/account/password', 'PUT', values); form.reset(); notify('Password updated.');
    } catch (error) { notify(error.message); }
  });

  $('#forgotLink')?.addEventListener('click', event => {
    event.preventDefault(); $('#forgotPanel').hidden = false; $('#logForm').hidden = true;
    const email = $('#logForm [name=email]')?.value; if (email) $('#forgotForm [name=email]').value = email;
  });
  $('#cancelForgot')?.addEventListener('click', () => { $('#forgotPanel').hidden = true; $('#logForm').hidden = false; });
  $('#forgotForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    try {
      const body = Object.fromEntries(new FormData(event.currentTarget));
      const result = await api('/forgot-password', 'POST', body);
      event.currentTarget.reset(); notify(result.message); $('#forgotPanel').hidden = true; $('#logForm').hidden = false;
    } catch (error) { notify(error.message); }
  });
  const resetToken = new URLSearchParams(location.search).get('reset');
  if (resetToken) {
    const panel = $('#resetPanel'); if (panel) { panel.hidden = false; $('#auth')?.scrollIntoView(); }
  }
  $('#resetForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    if (values.password !== values.confirm) return notify('Passwords do not match.');
    try {
      await api('/reset-password', 'POST', { token: resetToken, password: values.password });
      history.replaceState(null, '', location.pathname + '#auth'); event.currentTarget.reset(); $('#resetPanel').hidden = true;
      document.querySelector('.tab[data-t="log"]')?.click(); notify('Password reset. You can now log in.');
    } catch (error) { notify(error.message); }
  });

  // app.js owns the login state UI; reveal the settings link after it initializes.
  const updateSettingsVisibility = () => { if (settingsLink) settingsLink.hidden = !token(); };
  updateSettingsVisibility();
  document.addEventListener('click', event => { if (event.target.closest('#logoutBtn')) setTimeout(updateSettingsVisibility, 0); });
  const originalSetItem = Storage.prototype.setItem;
  // Refresh the gated link after login/register stores its session.
  const observer = new MutationObserver(updateSettingsVisibility);
  if (nav) observer.observe(nav, { childList: true, subtree: true, attributes: true });
  window.addEventListener('storage', updateSettingsVisibility);
})();
