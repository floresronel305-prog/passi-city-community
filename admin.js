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
  let panel, usersBox, bikesBox, refreshButton, approvalBox;
  function createPanel() {
    if (panel || !document.querySelector('#bikes')) return;
    panel = document.createElement('section'); panel.id = 'adminDashboard'; panel.className = 'glass pad'; panel.hidden = true; panel.style.margin = '24px 0';
    panel.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap"><div><h3>Administrator dashboard</h3><p class="note">Review membership requests and manage registered bikes.</p></div><button type="button" class="btn ghost" id="adminRefresh">Refresh data</button></div>
      <h3 class="mt">Pending member approvals</h3><div id="adminApprovals" class="cards"></div><h3 class="mt">All members</h3><div id="adminMembers" class="cards"></div><h3 class="mt">All registered bikes</h3><div id="adminBikes" class="cards"></div>`;
    const section = document.querySelector('#bikes'); section.insertBefore(panel, section.querySelector('.split'));
    usersBox = panel.querySelector('#adminMembers'); approvalBox = panel.querySelector('#adminApprovals'); bikesBox = panel.querySelector('#adminBikes'); refreshButton = panel.querySelector('#adminRefresh');
    refreshButton.addEventListener('click', loadDashboard); bikesBox.addEventListener('click', onBikeAction); usersBox.addEventListener('click', onApprovalAction); approvalBox.addEventListener('click', onApprovalAction);
  }
  async function loadDashboard() {
    if (!session()?.isAdmin || !panel) return;
    refreshButton.disabled = true;
    try {
      const [users, bikes] = await Promise.all([request('/admin/users'), request('/bikes')]);
      const pending = users.filter(user => user.approvalStatus === 'pending');
      approvalBox.innerHTML = pending.length ? pending.map(user => `<article class="card">${user.photoUrl ? `<img src="${esc(user.photoUrl)}" alt="" style="width:54px;height:54px;object-fit:cover;border-radius:50%">` : ''}<h4>${esc(user.name)}</h4><p>${esc(user.email)}<br>Barangay: ${esc(user.brgy)}</p><div class="row"><button type="button" class="btn primary" data-approval-id="${esc(user.id)}" data-approval-status="approved">Approve</button><button type="button" class="btn ghost" data-approval-id="${esc(user.id)}" data-approval-status="rejected">Reject</button></div></article>`).join('') : '<div class="empty glass">No pending membership requests.</div>';
      usersBox.innerHTML = users.length ? users.map(user => `<article class="card">${user.photoUrl ? `<img src="${esc(user.photoUrl)}" alt="${esc(user.name)} profile photo" style="width:54px;height:54px;object-fit:cover;border-radius:50%">` : ''}<h4>${esc(user.name)}${user.isAdmin ? ' <span class="tag">Admin</span>' : ''}</h4><p>${esc(user.email)}<br>Barangay: ${esc(user.brgy)}</p><span class="tag">${esc(user.approvalStatus)}</span>${!user.isAdmin && user.approvalStatus === 'approved' ? `<div class="row"><button type="button" class="btn ghost" data-approval-id="${esc(user.id)}" data-approval-status="rejected">Revoke approval</button></div>` : ''}${!user.isAdmin && user.approvalStatus === 'rejected' ? `<div class="row"><button type="button" class="btn primary" data-approval-id="${esc(user.id)}" data-approval-status="approved">Approve member</button></div>` : ''}</article>`).join('') : '<div class="empty glass">No members registered.</div>';
      bikesBox.innerHTML = bikes.length ? bikes.map(bike => `<article class="card"><h4>${esc(bike.brand)} ${esc(bike.model)}</h4><span class="tag">${esc(bike.type)}</span><span class="tag">${esc(bike.frame)}</span><p><b>Owner:</b> ${esc(bike.owner)} (${esc(bike.contact)})<br><b>Barangay:</b> ${esc(bike.brgy)}${bike.group ? `<br><b>Groupset:</b> ${esc(bike.group)}` : ''}</p><div class="row"><button type="button" class="btn ghost" data-admin-edit="${esc(bike.id)}">Edit</button><button type="button" class="btn ghost" data-admin-delete="${esc(bike.id)}">Delete</button></div></article>`).join('') : '<div class="empty glass">No bikes registered yet.</div>';
    } catch (error) { usersBox.innerHTML = `<div class="empty glass">Could not load admin data: ${esc(error.message)}</div>`; }
    finally { refreshButton.disabled = false; }
  }
  async function onApprovalAction(event) {
    const button = event.target.closest('[data-approval-id]'); if (!button) return;
    const status = button.dataset.approvalStatus, verb = status === 'approved' ? 'approve' : 'reject';
    if (!confirm(`Are you sure you want to ${verb} this membership?`)) return;
    button.disabled = true;
    try { await request(`/admin/users/${encodeURIComponent(button.dataset.approvalId)}/approval`, 'POST', { status }); await loadDashboard(); }
    catch (error) { alert(error.message); button.disabled = false; }
  }
  async function onBikeAction(event) {
    const delId = event.target.closest('[data-admin-delete]')?.dataset.adminDelete, editId = event.target.closest('[data-admin-edit]')?.dataset.adminEdit;
    if (delId) {
      if (!confirm('Delete this bike? This cannot be undone.')) return;
      try { await request('/bikes/' + encodeURIComponent(delId), 'DELETE'); await loadDashboard(); } catch (error) { alert(error.message); }
      return;
    }
    if (editId) {
      try {
        const bikes = await request('/bikes'), bike = bikes.find(item => item.id === editId), form = document.querySelector('#bikeForm');
        if (!bike || !form) throw new Error('Bike was not found.');
        for (const [key, value] of Object.entries(bike)) { const field = form.elements.namedItem(key); if (field && key !== 'id') field.value = value; }
        form.dataset.id = bike.id; document.querySelector('#bikeFormTitle').textContent = 'Edit bike'; document.querySelector('#bikeSave').textContent = 'Update bike'; document.querySelector('#bikeCancel').hidden = false; form.scrollIntoView({ behavior: 'smooth' });
      } catch (error) { alert(error.message); }
    }
  }
  function syncAdmin() {
    createPanel(); if (!panel) return;
    const current = session(), admin = current?.isAdmin === true; panel.hidden = !admin;
    const nav = document.querySelector('#adminNav');
    if (admin && !nav) { const link = document.createElement('a'); link.id = 'adminNav'; link.href = '#adminDashboard'; link.textContent = 'Admin'; document.querySelector('.nav nav')?.insertBefore(link, document.querySelector('#logoutBtn')); }
    else if (!admin && nav) nav.remove();
    const allowed = !!current && (admin || current.approvalStatus === 'approved'); document.querySelectorAll('.locked').forEach(section => { section.hidden = !allowed; });
    let notice = document.querySelector('#membershipStatus');
    if (current && !admin && current.approvalStatus !== 'approved') {
      if (!notice) { notice = document.createElement('p'); notice.id = 'membershipStatus'; notice.className = 'note'; document.querySelector('#welcome')?.append(notice); }
      notice.textContent = current.approvalStatus === 'rejected' ? 'Your membership request was not approved. Please contact the administrator if you think this is a mistake.' : 'Your account is registered and awaiting administrator approval. Bike registry and routes will unlock once approved.';
    } else notice?.remove();
    if (admin) loadDashboard();
  }
  async function syncFromServer() {
    if (!localStorage.getItem('token')) return syncAdmin();
    try { const data = await request('/me'); localStorage.setItem('session', JSON.stringify(data.user)); } catch {}
    syncAdmin();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', syncFromServer, { once: true }); else syncFromServer();
  const observer = new MutationObserver(syncAdmin);
  for (const selector of ['#welcome', '#authForms']) { const element = document.querySelector(selector); if (element) observer.observe(element, { childList: true, subtree: true, attributes: true }); }
  document.querySelector('#bikeForm')?.addEventListener('submit', () => setTimeout(() => { if (session()?.isAdmin) loadDashboard(); }, 1200));
})();
