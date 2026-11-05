'use strict';
(() => {
  const ADMIN_EMAIL = 'floresronel305@gmail.com';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const token = () => localStorage.getItem('token');
  const request = async (path, method = 'GET', body) => {
    const response = await fetch('/api' + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token() ? { Authorization: 'Bearer ' + token() } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Request failed');
    return data;
  };
  const session = () => { try { return JSON.parse(localStorage.getItem('session') || 'null'); } catch { return null; } };
  let panel, usersBox, bikesBox, refreshButton;

  function createPanel() {
    if (panel || !document.querySelector('#bikes')) return;
    panel = document.createElement('section');
    panel.id = 'adminDashboard';
    panel.className = 'glass pad';
    panel.hidden = true;
    panel.style.margin = '24px 0';
    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
        <div><h3>Administrator dashboard</h3><p class="note">Manage registered bikes and review member accounts.</p></div>
        <button type="button" class="btn ghost" id="adminRefresh">Refresh data</button>
      </div>
      <h3 class="mt">Members</h3><div id="adminMembers" class="cards"></div>
      <h3 class="mt">All registered bikes</h3><div id="adminBikes" class="cards"></div>`;
    const bikesSection = document.querySelector('#bikes');
    bikesSection.insertBefore(panel, bikesSection.querySelector('.split'));
    usersBox = panel.querySelector('#adminMembers');
    bikesBox = panel.querySelector('#adminBikes');
    refreshButton = panel.querySelector('#adminRefresh');
    refreshButton.addEventListener('click', loadDashboard);
    bikesBox.addEventListener('click', onBikeAction);
  }

  async function loadDashboard() {
    if (!session()?.isAdmin || !panel) return;
    refreshButton.disabled = true;
    try {
      const [users, bikes] = await Promise.all([request('/admin/users'), request('/bikes')]);
      usersBox.innerHTML = users.length ? users.map(user => `
        <article class="card"><h4>${esc(user.name)}${user.isAdmin ? ' <span class="tag">Admin</span>' : ''}</h4>
          <p>${esc(user.email)}<br>Barangay: ${esc(user.brgy)}</p></article>`).join('')
        : '<div class="empty glass">No members registered.</div>';
      bikesBox.innerHTML = bikes.length ? bikes.map(bike => `
        <article class="card" data-bike-id="${esc(bike.id)}">
          <h4>${esc(bike.brand)} ${esc(bike.model)}</h4>
          <span class="tag">${esc(bike.type)}</span><span class="tag">${esc(bike.frame)}</span>
          <p><b>Owner:</b> ${esc(bike.owner)} (${esc(bike.contact)})<br><b>Barangay:</b> ${esc(bike.brgy)}${bike.group ? `<br><b>Groupset:</b> ${esc(bike.group)}` : ''}</p>
          <div class="row"><button type="button" class="btn ghost" data-admin-edit="${esc(bike.id)}">Edit</button>
          <button type="button" class="btn ghost" data-admin-delete="${esc(bike.id)}">Delete</button></div>
        </article>`).join('') : '<div class="empty glass">No bikes registered yet.</div>';
    } catch (error) {
      usersBox.innerHTML = `<div class="empty glass">Could not load admin data: ${esc(error.message)}</div>`;
    } finally { refreshButton.disabled = false; }
  }

  async function onBikeAction(event) {
    const delId = event.target.closest('[data-admin-delete]')?.dataset.adminDelete;
    const editId = event.target.closest('[data-admin-edit]')?.dataset.adminEdit;
    if (delId) {
      if (!confirm('Delete this bike? This cannot be undone.')) return;
      try { await request('/bikes/' + encodeURIComponent(delId), 'DELETE'); await loadDashboard(); }
      catch (error) { alert(error.message); }
      return;
    }
    if (editId) {
      try {
        const bikes = await request('/bikes');
        const bike = bikes.find(item => item.id === editId);
        const form = document.querySelector('#bikeForm');
        if (!bike || !form) throw new Error('Bike was not found.');
        for (const [key, value] of Object.entries(bike)) {
          const field = form.elements.namedItem(key);
          if (field && key !== 'id') field.value = value;
        }
        form.dataset.id = bike.id;
        document.querySelector('#bikeFormTitle').textContent = 'Edit bike';
        document.querySelector('#bikeSave').textContent = 'Update bike';
        document.querySelector('#bikeCancel').hidden = false;
        form.scrollIntoView({ behavior: 'smooth' });
      } catch (error) { alert(error.message); }
    }
  }

  function syncAdmin() {
    createPanel();
    if (!panel) return;
    const isAdmin = session()?.isAdmin === true;
    panel.hidden = !isAdmin;
    const adminNav = document.querySelector('#adminNav');
    if (isAdmin && !adminNav) {
      const link = document.createElement('a');
      link.id = 'adminNav'; link.href = '#adminDashboard'; link.textContent = 'Admin';
      document.querySelector('.nav nav')?.insertBefore(link, document.querySelector('#logoutBtn'));
    } else if (!isAdmin && adminNav) adminNav.remove();
    if (isAdmin) loadDashboard();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', syncAdmin, { once: true });
  else syncAdmin();
  const observer = new MutationObserver(syncAdmin);
  for (const selector of ['#welcome', '#authForms']) {
    const element = document.querySelector(selector);
    if (element) observer.observe(element, { childList: true, subtree: true, attributes: true });
  }
  // Refresh after the existing bike form finishes its async save handler.
  document.querySelector('#bikeForm')?.addEventListener('submit', () => setTimeout(() => { if (session()?.isAdmin) loadDashboard(); }, 1200));
})();
