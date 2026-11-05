'use strict';
/* Account settings, profile photo, and password recovery UI. Loaded after app.js. */
(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const session = () => { try { return JSON.parse(localStorage.getItem('session') || 'null'); } catch { return null; } };
  const api = async (path, body, auth = false) => {
    const token = localStorage.getItem('token');
    const response = await fetch('/api' + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(auth && token ? { Authorization: 'Bearer ' + token } : {}) },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
    return data;
  };
  const showMessage = (element, text, isError = false) => {
    element.textContent = text;
    element.classList.toggle('account-error', isError);
    element.hidden = false;
  };

  const styles = document.createElement('style');
  styles.textContent = `
    .account-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}
    .account-panel{margin-top:16px;padding:18px;border:1px solid rgba(22,104,227,.18);border-radius:16px;background:rgba(255,255,255,.55)}
    .account-panel h4{font-family:'Sora',sans-serif;color:#0a3d91;margin-bottom:12px}
    .account-panel label{margin-top:10px}.account-panel input{margin-bottom:4px}
    .account-message{margin-top:10px;color:#0a3d91;font-size:.9rem}.account-error{color:#b42318}
    .profile-photo{width:88px;height:88px;border-radius:50%;object-fit:cover;background:#eaf3ff;border:3px solid white;box-shadow:0 3px 14px #1668e333}
    .profile-row{display:flex;align-items:center;gap:14px;margin:12px 0}
    .forgot-link{display:inline-block;margin-top:12px;color:#1668e3;font-weight:600;cursor:pointer;background:none;border:0;text-decoration:underline;font:inherit}
  `;
  document.head.append(styles);

  const login = $('#logForm');
  if (login && !$('#forgotPasswordLink')) {
    const link = document.createElement('button');
    link.type = 'button'; link.id = 'forgotPasswordLink'; link.className = 'forgot-link';
    link.textContent = 'Forgot password?';
    login.append(link);
    link.addEventListener('click', () => {
      const box = $('#passwordRecovery');
      box.hidden = false;
      $('#recoveryEmail').value = login.elements.email.value || '';
      $('#recoveryEmail').focus();
    });
  }

  const recovery = document.createElement('section');
  recovery.id = 'passwordRecovery'; recovery.className = 'account-panel'; recovery.hidden = true;
  recovery.innerHTML = `
    <h4>Password recovery</h4>
    <form id="forgotForm">
      <label>Email address<input id="recoveryEmail" name="email" type="email" autocomplete="email" required></label>
      <button class="btn primary">Email me a reset link</button>
      <button class="btn ghost" id="closeRecovery" type="button">Cancel</button>
      <p class="account-message" id="recoveryMessage" hidden></p>
    </form>
    <form id="resetForm" hidden>
      <label>New password<input name="password" type="password" minlength="6" autocomplete="new-password" required></label>
      <button class="btn primary">Save new password</button>
      <p class="account-message" id="resetMessage" hidden></p>
    </form>`;
  $('#auth .auth').append(recovery);
  $('#closeRecovery').addEventListener('click', () => { recovery.hidden = true; });
  $('#forgotForm').addEventListener('submit', async event => {
    event.preventDefault();
    const message = $('#recoveryMessage');
    try {
      const result = await api('/forgot-password', { email: $('#recoveryEmail').value.trim() });
      showMessage(message, result.message || 'If that email is registered, a reset link will be sent.');
    } catch (error) { showMessage(message, error.message, true); }
  });
  $('#resetForm').addEventListener('submit', async event => {
    event.preventDefault();
    const message = $('#resetMessage');
    try {
      const result = await api('/reset-password', { token: new URLSearchParams(location.search).get('reset'), password: event.currentTarget.elements.password.value });
      showMessage(message, result.message || 'Password updated. Please log in.');
      event.currentTarget.reset();
      history.replaceState(null, '', location.pathname + location.hash);
    } catch (error) { showMessage(message, error.message, true); }
  });

  const welcome = $('#welcome');
  const addSettings = () => {
    const current = session();
    if (!welcome || !current || $('#accountSettingsBtn', welcome)) return;
    const actions = document.createElement('div');
    actions.className = 'account-actions';
    actions.innerHTML = '<button type="button" class="btn ghost" id="accountSettingsBtn">⚙ Settings</button>';
    const panel = document.createElement('div');
    panel.id = 'accountSettingsPanel'; panel.className = 'account-panel'; panel.hidden = true;
    panel.innerHTML = `
      <h4>Account settings</h4>
      <div class="profile-row"><img id="settingsPhotoPreview" class="profile-photo" alt="Your profile photo"><span>Choose a profile photo (JPG, PNG, or WebP; up to 5 MB before processing).</span></div>
      <form id="profileSettingsForm">
        <label>Profile photo<input id="settingsPhoto" name="photoFile" type="file" accept="image/jpeg,image/png,image/webp"></label>
        <label>Full name<input name="name" maxlength="100" required></label>
        <label>Barangay<input name="brgy" maxlength="100" required></label>
        <button class="btn primary">Save profile</button>
        <button type="button" class="btn ghost" id="removePhoto">Remove photo</button>
        <p class="account-message" id="profileMessage" hidden></p>
      </form>
      <hr style="margin:20px 0;border:0;border-top:1px solid #1668e322">
      <h4>Change password</h4>
      <form id="changePasswordForm">
        <label>Current password<input name="currentPassword" type="password" autocomplete="current-password" required></label>
        <label>New password<input name="newPassword" type="password" minlength="6" autocomplete="new-password" required></label>
        <button class="btn primary">Change password</button>
        <p class="account-message" id="passwordMessage" hidden></p>
      </form>`;
    welcome.append(actions, panel);
    $('#accountSettingsBtn', welcome).addEventListener('click', () => { panel.hidden = !panel.hidden; });
    const profileForm = $('#profileSettingsForm', panel);
    profileForm.elements.name.value = current.name || '';
    profileForm.elements.brgy.value = current.brgy || '';
    const preview = $('#settingsPhotoPreview', panel);
    preview.src = current.photo || 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="88" height="88" viewBox="0 0 88 88"%3E%3Crect width="88" height="88" rx="44" fill="%23eaf3ff"/%3E%3Ctext x="44" y="55" text-anchor="middle" font-size="42" fill="%231668e3"%3E%3F%3C/text%3E%3C/svg%3E';
    let photoData = current.photo || null;
    $('#settingsPhoto', panel).addEventListener('change', async event => {
      const file = event.target.files?.[0];
      if (!file) return;
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
        showMessage($('#profileMessage', panel), 'Choose a JPG, PNG, or WebP image smaller than 5 MB.', true); event.target.value = ''; return;
      }
      try {
        const bitmap = await createImageBitmap(file);
        const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
        photoData = canvas.toDataURL('image/jpeg', .82);
        if (photoData.length > 680000) photoData = canvas.toDataURL('image/jpeg', .65);
        if (photoData.length > 700000) throw new Error('This photo is too large after processing. Please choose another image.');
        preview.src = photoData;
        $('#profileMessage', panel).hidden = true;
      } catch (error) { showMessage($('#profileMessage', panel), error.message || 'Could not read that photo.', true); }
    });
    $('#removePhoto', panel).addEventListener('click', () => { photoData = null; preview.src = ''; $('#settingsPhoto', panel).value = ''; });
    profileForm.addEventListener('submit', async event => {
      event.preventDefault();
      const message = $('#profileMessage', panel);
      try {
        const result = await fetch('/api/account', {
          method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('token') },
          body: JSON.stringify({ name: profileForm.elements.name.value.trim(), brgy: profileForm.elements.brgy.value.trim(), photo: photoData }),
        });
        const data = await result.json().catch(() => ({}));
        if (!result.ok) throw new Error(data.error || 'Could not save your profile.');
        localStorage.setItem('session', JSON.stringify(data.user));
        showMessage(message, 'Profile saved. Refreshing…');
        location.reload();
      } catch (error) { showMessage(message, error.message, true); }
    });
    $('#changePasswordForm', panel).addEventListener('submit', async event => {
      event.preventDefault();
      const message = $('#passwordMessage', panel);
      const form = event.currentTarget;
      try {
        const result = await fetch('/api/account/password', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('token') },
          body: JSON.stringify({ currentPassword: form.elements.currentPassword.value, newPassword: form.elements.newPassword.value }),
        });
        const data = await result.json().catch(() => ({}));
        if (!result.ok) throw new Error(data.error || 'Could not change your password.');
        form.reset(); showMessage(message, data.message || 'Password changed successfully.');
      } catch (error) { showMessage(message, error.message, true); }
    });
  };

  if (welcome) new MutationObserver(addSettings).observe(welcome, { childList: true });
  addSettings();

  const resetToken = new URLSearchParams(location.search).get('reset');
  if (resetToken) {
    recovery.hidden = false;
    $('#forgotForm').hidden = true;
    $('#resetForm').hidden = false;
    $('#auth').scrollIntoView();
  }
})();
