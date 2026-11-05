'use strict';
(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const token = () => localStorage.getItem('token');
  const formValues = form => Object.fromEntries(new FormData(form));
  const toast = message => {
    const el = $('#toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove('show'), 4000);
  };
  async function api(path, method = 'GET', body) {
    const headers = { ...(token() ? { Authorization: `Bearer ${token()}` } : {}) };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Request failed. Please try again.');
    return data;
  }
  function statusFor(form) {
    let status = form.querySelector('[data-form-status]');
    if (!status) {
      status = document.createElement('p');
      status.dataset.formStatus = '';
      status.className = 'note form-status';
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      form.append(status);
    }
    status.replaceChildren();
    return status;
  }
  function showForm(formId) {
    ['regForm', 'logForm', 'forgotForm', 'resetForm'].forEach(id => {
      const form = $(`#${id}`);
      if (form) form.hidden = id !== formId;
    });
    $$('.tab').forEach(tab => tab.classList.toggle('on', tab.dataset.t === (formId === 'regForm' ? 'reg' : 'log')));
  }
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const profileForm = $('#profileForm');
  const passwordForm = $('#passwordForm');
  const forgotForm = $('#forgotForm');
  const resetForm = $('#resetForm');
  const logForm = $('#logForm');
  const groupInput = $('#groupPhotoInput');
  let signedIn = false;
  let photoExists = false;
  let syncVersion = 0;

  function setSessionUI(user) {
    signedIn = !!user;
    const settingsNav = $('#settingsNav');
    if (settingsNav) settingsNav.hidden = !signedIn;
    const upload = $('.upload-button');
    if (upload) upload.hidden = !signedIn;
    const remove = $('#removeGroupPhoto');
    if (remove) remove.hidden = !(signedIn && photoExists);
    if (!signedIn) {
      if (profileForm) profileForm.reset();
      return;
    }
    if (profileForm) {
      profileForm.elements.name.value = user.name || '';
      profileForm.elements.brgy.value = user.brgy || '';
    }
    if ($('#bikeForm')) {
      const owner = $('#bikeForm [name=owner]');
      const brgy = $('#bikeForm [name=brgy]');
      if (owner && !owner.value) owner.value = user.name || '';
      if (brgy && user.brgy) brgy.value = user.brgy;
    }
  }

  async function refreshSession() {
    const version = ++syncVersion;
    if (!token()) return setSessionUI(null);
    try {
      const { user } = await api('/me');
      if (version !== syncVersion) return;
      localStorage.setItem('session', JSON.stringify(user));
      setSessionUI(user);
    } catch (error) {
      if (version !== syncVersion) return;
      if (error.message.includes('log in')) {
        localStorage.removeItem('token');
        localStorage.removeItem('session');
        setSessionUI(null);
      } else toast(error.message);
    }
  }

  // app.js owns register/login. Observe its existing session UI transition to hydrate settings.
  const welcome = $('#welcome');
  if (welcome) new MutationObserver(() => { if (!welcome.hidden && token()) refreshSession(); }).observe(welcome, { attributes: true, attributeFilter: ['hidden'] });
  $$('.tab').forEach(tab => tab.addEventListener('click', () => showForm(tab.dataset.t === 'reg' ? 'regForm' : 'logForm')));

  const barangaySelect = $('#settingsBrgy');
  if (barangaySelect && $('#brgySel')) barangaySelect.innerHTML = $('#brgySel').innerHTML;
  $('#showForgot')?.addEventListener('click', () => showForm('forgotForm'));
  $('#backToLogin')?.addEventListener('click', () => showForm('logForm'));

  profileForm?.addEventListener('submit', async event => {
    event.preventDefault();
    const status = statusFor(profileForm);
    try {
      const { user } = await api('/profile', 'PUT', formValues(profileForm));
      localStorage.setItem('session', JSON.stringify(user));
      setSessionUI(user);
      const greeting = $('#welcome h3');
      if (greeting) greeting.textContent = `Hello, ${user.name}`;
      const note = $('#welcome .note');
      if (note) note.textContent = `Barangay ${user.brgy}. Your bike registry and routes are unlocked below.`;
      if ($('#bikeForm [name=owner]')) $('#bikeForm [name=owner]').value = user.name;
      if ($('#bikeForm [name=brgy]')) $('#bikeForm [name=brgy]').value = user.brgy;
      status.textContent = 'Profile saved.';
    } catch (error) { status.textContent = error.message; }
  });

  passwordForm?.addEventListener('submit', async event => {
    event.preventDefault();
    const values = formValues(passwordForm), status = statusFor(passwordForm);
    if (values.newPassword !== values.confirmPassword) { status.textContent = 'New password and confirmation do not match.'; return; }
    try {
      await api('/password', 'PUT', { currentPassword: values.currentPassword, newPassword: values.newPassword });
      passwordForm.reset();
      status.textContent = 'Password updated. Other active sessions have been signed out.';
    } catch (error) { status.textContent = error.message; }
  });

  forgotForm?.addEventListener('submit', async event => {
    event.preventDefault();
    const status = statusFor(forgotForm);
    try {
      const result = await api('/forgot-password', 'POST', formValues(forgotForm));
      status.textContent = result.message || 'If an account exists for that email, a reset link has been created.';
      // Development mode returns a link; production should deliver it via a configured mail provider.
      if (result.resetUrl) {
        const link = document.createElement('a');
        link.href = result.resetUrl;
        link.textContent = ' Open password reset link';
        link.rel = 'noopener noreferrer';
        status.append(link);
      }
    } catch (error) { status.textContent = error.message; }
  });

  function tokenFromUrl() { return new URLSearchParams(location.search).get('reset') || ''; }
  const initialResetToken = tokenFromUrl();
  if (initialResetToken && resetForm) {
    showForm('resetForm');
    $('#auth')?.scrollIntoView({ behavior: 'smooth' });
  }
  resetForm?.addEventListener('submit', async event => {
    event.preventDefault();
    const status = statusFor(resetForm), password = resetForm.elements.password.value;
    const resetToken = tokenFromUrl() || initialResetToken;
    if (!resetToken) { status.textContent = 'This reset link is invalid or expired. Request a new one.'; return; }
    try {
      const result = await api('/reset-password', 'POST', { token: resetToken, password });
      resetForm.reset();
      history.replaceState(null, '', `${location.pathname}${location.hash || '#auth'}`);
      status.textContent = result.message || 'Password updated. Please log in.';
      setTimeout(() => showForm('logForm'), 1500);
    } catch (error) { status.textContent = error.message; }
  });

  function renderPhoto(dataUrl) {
    const image = $('#groupPhoto'), placeholder = $('#groupPhotoEmpty');
    photoExists = !!dataUrl;
    if (image) { image.hidden = !dataUrl; if (dataUrl) image.src = dataUrl; else image.removeAttribute('src'); }
    if (placeholder) placeholder.hidden = !!dataUrl;
    const remove = $('#removeGroupPhoto');
    if (remove) remove.hidden = !(signedIn && photoExists);
  }
  async function loadPhoto() {
    try { renderPhoto((await api('/group-photo')).photo); }
    catch (error) { toast(error.message); }
  }
  groupInput?.addEventListener('change', async () => {
    const file = groupInput.files?.[0];
    if (!file) return;
    if (!signedIn || !token()) { toast('Log in to upload a group photo.'); groupInput.value = ''; return; }
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.type)) { toast('Choose a JPG, PNG, or WebP image.'); groupInput.value = ''; return; }
    if (file.size > 2 * 1024 * 1024) { toast('Photo must be smaller than 2 MB.'); groupInput.value = ''; return; }
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Could not read the selected image.'));
        reader.readAsDataURL(file);
      });
      await api('/group-photo', 'PUT', { photo: dataUrl });
      renderPhoto(dataUrl);
      toast('Community group photo uploaded.');
    } catch (error) { toast(error.message); }
    finally { groupInput.value = ''; }
  });
  $('#removeGroupPhoto')?.addEventListener('click', async () => {
    if (!signedIn || !photoExists || !confirm('Remove the community group photo?')) return;
    try { await api('/group-photo', 'DELETE'); renderPhoto(null); toast('Community photo removed.'); }
    catch (error) { toast(error.message); }
  });

  // Protect gated navigation and provide a clear login prompt for Settings.
  $('#settingsNav')?.addEventListener('click', event => {
    if (!signedIn) { event.preventDefault(); $('#auth')?.scrollIntoView({ behavior: 'smooth' }); toast('Please log in to open Settings.'); }
  });
  refreshSession();
  loadPhoto();
})();
