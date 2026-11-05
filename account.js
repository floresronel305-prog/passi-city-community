'use strict';
(() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const token = () => localStorage.getItem('token');
  const request = async (path, method = 'GET', body) => {
    const response = await fetch('/api' + path, { method, headers: { 'Content-Type': 'application/json', ...(token() ? { Authorization: 'Bearer ' + token() } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Request failed');
    return data;
  };
  const session = () => { try { return JSON.parse(localStorage.getItem('session') || 'null'); } catch { return null; } };
  const saveSession = user => { localStorage.setItem('session', JSON.stringify(user)); renderAccount(); };
  let settings, status, preview;

  function ensureAccountUI() {
    if (settings || !document.querySelector('#auth')) return;
    settings = document.createElement('section');
    settings.id = 'accountSettings'; settings.className = 'glass pad'; settings.hidden = true;
    settings.style.maxWidth = '640px'; settings.style.marginTop = '18px';
    settings.innerHTML = `
      <h3>Account settings</h3><p class="note">Update your account details, password, and profile/group photo.</p>
      <div id="accountStatus" class="note" role="status" aria-live="polite"></div>
      <form id="profileSettingsForm">
        <label>Full name<input name="name" required maxlength="100"></label>
        <label>Barangay<input name="brgy" required maxlength="100"></label>
        <button class="btn primary" type="submit">Save profile</button>
      </form>
      <form id="photoSettingsForm" style="margin-top:20px">
        <label>Profile / group photo (JPEG, PNG or WebP; max 2 MB)<input name="photo" type="file" accept="image/jpeg,image/png,image/webp" required></label>
        <img id="accountPhotoPreview" alt="Profile photo preview" hidden style="width:120px;height:120px;object-fit:cover;border-radius:50%;margin:8px 0">
        <div class="row"><button class="btn primary" type="submit">Upload photo</button><button class="btn ghost" id="removePhoto" type="button" hidden>Remove photo</button></div>
      </form>
      <form id="passwordSettingsForm" style="margin-top:20px">
        <h4>Change password</h4>
        <label>Current password<input name="currentPassword" type="password" autocomplete="current-password" required></label>
        <label>New password (at least 8 characters)<input name="newPassword" type="password" minlength="8" autocomplete="new-password" required></label>
        <button class="btn primary" type="submit">Change password</button>
      </form>`;
    document.querySelector('#auth .auth')?.append(settings);
    status = settings.querySelector('#accountStatus'); preview = settings.querySelector('#accountPhotoPreview');
    settings.querySelector('#profileSettingsForm').addEventListener('submit', saveProfile);
    settings.querySelector('#photoSettingsForm').addEventListener('submit', uploadPhoto);
    settings.querySelector('#passwordSettingsForm').addEventListener('submit', changePassword);
    settings.querySelector('#removePhoto').addEventListener('click', removePhoto);
    settings.querySelector('[name=photo]').addEventListener('change', previewPhoto);
  }

  function setStatus(message, isError = false) {
    if (!status) return;
    status.textContent = message; status.style.color = isError ? '#b42318' : '';
  }
  function renderAccount() {
    ensureAccountUI();
    if (!settings) return;
    const user = session();
    settings.hidden = !user;
    if (!user) return;
    const profile = settings.querySelector('#profileSettingsForm');
    if (document.activeElement?.form !== profile) {
      profile.elements.name.value = user.name || '';
      profile.elements.brgy.value = user.brgy || '';
    }
    preview.hidden = !user.photoUrl;
    if (user.photoUrl) preview.src = user.photoUrl;
    settings.querySelector('#removePhoto').hidden = !user.photoUrl;
  }

  async function saveProfile(event) {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      const result = await request('/settings', 'PUT', { name: form.elements.name.value, brgy: form.elements.brgy.value });
      saveSession(result.user);
      const welcome = document.querySelector('#welcome h3'); if (welcome) welcome.textContent = `Hello, ${result.user.name}`;
      setStatus('Profile updated.');
    } catch (error) { setStatus(error.message, true); }
  }

  function previewPhoto(event) {
    const file = event.currentTarget.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { setStatus('Photo must be 2 MB or smaller.', true); event.currentTarget.value = ''; return; }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setStatus('Choose a JPEG, PNG, or WebP image.', true); event.currentTarget.value = ''; return; }
    const reader = new FileReader();
    reader.onload = () => { preview.src = reader.result; preview.hidden = false; };
    reader.readAsDataURL(file);
  }

  async function uploadPhoto(event) {
    event.preventDefault();
    const form = event.currentTarget, file = form.elements.photo.files[0];
    if (!file) return setStatus('Choose a photo first.', true);
    try {
      const image = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
      const result = await request('/profile/photo', 'POST', { image });
      saveSession(result.user); form.reset(); setStatus('Photo uploaded.');
    } catch (error) { setStatus(error.message, true); }
  }

  async function removePhoto() {
    if (!confirm('Remove your current photo?')) return;
    try { const result = await request('/profile/photo', 'DELETE'); saveSession(result.user); setStatus('Photo removed.'); }
    catch (error) { setStatus(error.message, true); }
  }

  async function changePassword(event) {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      const result = await request('/settings/password', 'POST', { currentPassword: form.elements.currentPassword.value, newPassword: form.elements.newPassword.value });
      form.reset(); setStatus(result.message);
    } catch (error) { setStatus(error.message, true); }
  }

  function ensureForgotPassword() {
    const login = document.querySelector('#logForm');
    if (!login || login.querySelector('#forgotPasswordLink')) return;
    const link = document.createElement('button'); link.id = 'forgotPasswordLink'; link.type = 'button'; link.className = 'btn ghost'; link.textContent = 'Forgot password?'; link.style.marginTop = '10px';
    login.append(link);
    link.addEventListener('click', () => {
      const email = login.elements.email.value.trim();
      const entered = email || prompt('Enter the email address for your account:');
      if (entered) requestReset(entered);
      else showResetMessage('Enter your email address and try again.', true);
    });
  }

  function ensureResetPanel() {
    if (document.querySelector('#passwordResetPanel')) return document.querySelector('#passwordResetPanel');
    const panel = document.createElement('section'); panel.id = 'passwordResetPanel'; panel.className = 'glass pad'; panel.hidden = true; panel.style.maxWidth = '480px'; panel.style.marginTop = '18px';
    panel.innerHTML = `<h3>Reset password</h3><p id="resetMessage" class="note" role="status" aria-live="polite"></p>
      <form id="resetPasswordForm"><label>Email<input name="email" type="email" required></label>
      <label>New password (at least 8 characters)<input name="password" type="password" minlength="8" autocomplete="new-password" required></label>
      <button class="btn primary" type="submit">Set new password</button></form>
      <button id="backToLogin" class="btn ghost" type="button" style="margin-top:10px">Back to login</button>`;
    document.querySelector('#auth')?.append(panel);
    panel.querySelector('#resetPasswordForm').addEventListener('submit', submitReset);
    panel.querySelector('#backToLogin').addEventListener('click', () => { panel.hidden = true; document.querySelector('#authForms').hidden = false; });
    return panel;
  }

  function showResetMessage(message, isError = false) {
    const panel = ensureResetPanel();
    panel.querySelector('#resetMessage').textContent = message;
    panel.querySelector('#resetMessage').style.color = isError ? '#b42318' : '';
  }

  async function requestReset(email) {
    try {
      const result = await request('/password/forgot', 'POST', { email });
      showResetMessage(result.message || 'Check your email for a password reset link.');
    } catch (error) { showResetMessage(error.message, true); }
  }

  async function submitReset(event) {
    event.preventDefault();
    const params = new URLSearchParams(location.search), resetToken = params.get('reset');
    if (!resetToken) return showResetMessage('Reset token is missing. Request a new reset link.', true);
    const form = event.currentTarget;
    try {
      const result = await request('/password/reset', 'POST', { token: resetToken, email: form.elements.email.value, password: form.elements.password.value });
      showResetMessage(result.message);
      form.hidden = true;
      history.replaceState(null, '', location.pathname + '#auth');
      document.querySelector('#authForms').hidden = false;
      const loginTab = document.querySelector('.tab[data-t="log"]'); loginTab?.click();
    } catch (error) { showResetMessage(error.message, true); }
  }

  function init() {
    ensureAccountUI(); ensureForgotPassword();
    renderAccount();
    const resetToken = new URLSearchParams(location.search).get('reset');
    if (resetToken) {
      const panel = ensureResetPanel(); panel.hidden = false;
      document.querySelector('#authForms').hidden = true;
      panel.querySelector('#resetPasswordForm').elements.email.value = new URLSearchParams(location.search).get('email') || '';
    }
    const observer = new MutationObserver(renderAccount);
    const welcome = document.querySelector('#welcome');
    if (welcome) observer.observe(welcome, { childList: true, subtree: true, attributes: true });
    document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', ensureForgotPassword));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})();
