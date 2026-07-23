// MyPage app shell: token plumbing, tiny router, My Pages home screen and
// the five-door creation chooser. The editor lives in editor.js.
(function () {
  'use strict';

  // The shell injects ?token=… on the initial iframe load only; keep it in
  // sessionStorage so SPA navigations (pushState) keep working after the
  // query string changes.
  const params = new URLSearchParams(location.search);
  let token = params.get('token') || sessionStorage.getItem('mp_token') || '';
  if (params.get('token')) sessionStorage.setItem('mp_token', token);

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      method: opts.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'x-usernode-token': token } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch {}
    if (!res.ok) {
      const err = new Error((data && data.error) || 'Request failed (' + res.status + ')');
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  }

  function timeAgo(iso) {
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return '';
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 90) return 'just now';
    if (s < 3600) return Math.round(s / 60) + 'm ago';
    if (s < 86400) return Math.round(s / 3600) + 'h ago';
    if (s < 86400 * 30) return Math.round(s / 86400) + 'd ago';
    return new Date(iso).toLocaleDateString();
  }

  function slugify(s) {
    let out = String(s || '').toLowerCase().normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-')
      .slice(0, 30).replace(/^-+|-+$/g, '');
    if (out.length < 3) out = ('my-page-' + out).slice(0, 30).replace(/-+$/g, '');
    return out;
  }

  function toast(msg) {
    if (window.unNative && unNative.toast) { unNative.toast(msg); return; }
    const t = document.createElement('div');
    t.className = 'mp-mini-toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2200);
  }

  // Minimal modal used everywhere (own implementation so the app has no
  // hard dependency on the hosted kit being reachable).
  function openModal({ title, contentEl, actions = [], onClose }) {
    const backdrop = document.createElement('div');
    backdrop.className = 'mp-backdrop';
    const modal = document.createElement('div');
    modal.className = 'mp-modal';
    if (title) {
      const h = document.createElement('h2');
      h.className = 'mp-modal-title';
      h.textContent = title;
      modal.appendChild(h);
    }
    if (contentEl) modal.appendChild(contentEl);
    let footer = null;
    if (actions.length) {
      footer = document.createElement('div');
      footer.className = 'mp-modal-actions';
      modal.appendChild(footer);
    }
    const ctl = {
      el: modal,
      close() {
        backdrop.remove();
        if (onClose) onClose();
      },
    };
    actions.forEach((a) => {
      const b = document.createElement('button');
      b.className = a.accent ? 'mp-btn mp-btn-accent' : 'mp-btn';
      b.textContent = a.label;
      b.addEventListener('click', () => a.onClick ? a.onClick(ctl, b) : ctl.close());
      footer.appendChild(b);
    });
    backdrop.addEventListener('pointerdown', (e) => { if (e.target === backdrop) ctl.close(); });
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    return ctl;
  }

  const SUBJECTS = {
    self: { emoji: '🌟', door: 'for myself', chip: 'my corner', nameLabel: null },
    friend: { emoji: '💌', door: 'someone I know', chip: 'for a friend', nameLabel: 'Their name' },
    pet: { emoji: '🐾', door: 'my pet', chip: 'pet page', nameLabel: 'Your pet’s name' },
    oc: { emoji: '🎭', door: 'my OC', chip: 'OC page', nameLabel: 'Your OC’s name' },
    character: { emoji: '📚', door: 'a character', chip: 'shrine', nameLabel: 'The character' },
  };

  // ------------------------------------------------------------------ router

  function navigate(path, replace) {
    history[replace ? 'replaceState' : 'pushState']({}, '', path);
    route();
  }
  window.addEventListener('popstate', route);

  function route() {
    const m = location.pathname.match(/^\/edit\/(\d+)$/);
    if (m) return window.MPEditor.open(parseInt(m[1], 10));
    renderMyPages();
  }

  // ---------------------------------------------------------------- My Pages

  async function renderMyPages() {
    const app = document.getElementById('app');
    app.innerHTML = `
      <header class="mp-home-header">
        <div>
          <div class="mp-kicker">your corner of the internet</div>
          <h1 class="mp-wordmark">MyPage</h1>
        </div>
        <button id="mp-new-btn" class="mp-btn mp-btn-accent">＋ New page</button>
      </header>
      <main class="mp-home" data-testid="my-pages">
        <div class="mp-muted" style="padding:24px 4px;">loading your pages…</div>
      </main>
    `;
    document.getElementById('mp-new-btn').addEventListener('click', openChooser);

    const main = app.querySelector('main');
    let pages;
    try {
      ({ pages } = await api('/api/me/pages'));
    } catch (err) {
      main.innerHTML = `<div class="mp-muted" style="padding:24px 4px;">Couldn’t load your pages — ${escapeHtml(err.message)}</div>`;
      return;
    }

    if (!pages.length) {
      main.innerHTML = `
        <div class="mp-empty">
          <div class="mp-empty-art">✨🖼️🐾</div>
          <p><b>No pages yet.</b> Make one — for yourself, your best friend, your dog, your OC, or your comfort character.</p>
          <p class="mp-muted">No feed here. Just your pages.</p>
        </div>`;
      return;
    }

    main.innerHTML = `<div class="mp-sect-label">Mine</div><div class="mp-card-list"></div>
      <p class="mp-muted" style="text-align:center;padding:22px 8px 8px;">no feed here — just your pages</p>`;
    const list = main.querySelector('.mp-card-list');
    pages.forEach((p) => {
      const meta = SUBJECTS[p.subject_type] || SUBJECTS.self;
      const card = document.createElement('button');
      card.className = 'mp-card';
      const status = p.published
        ? `<span class="mp-status-pub">published · /p/${escapeHtml(p.slug)}</span>`
        : `<span class="mp-status-draft">draft</span> · last touched ${escapeHtml(timeAgo(p.updated_at))}`;
      const visits = Number(p.visits) > 0 ? ` · ${Number(p.visits)} visits` : '';
      const pending = p.pending_signs > 0
        ? `<span class="mp-badge">${p.pending_signs} guestbook sign${p.pending_signs === 1 ? '' : 's'} to approve</span>` : '';
      card.innerHTML = `
        <div class="mp-card-row1">
          <span class="mp-card-title">${escapeHtml(p.title)}</span>
          <span class="mp-chip">${meta.emoji} ${escapeHtml(meta.chip)}</span>
        </div>
        <div class="mp-card-row2">${status}${visits} ${pending}</div>`;
      card.addEventListener('click', () => navigate('/edit/' + p.id));
      list.appendChild(card);
    });
  }

  // ----------------------------------------------------- five-door chooser

  function openChooser() {
    const content = document.createElement('div');
    content.className = 'mp-doors';
    let ctl;
    Object.entries(SUBJECTS).forEach(([key, meta]) => {
      const door = document.createElement('button');
      door.className = 'mp-door';
      door.innerHTML = `<span class="mp-door-emoji">${meta.emoji}</span><span>${escapeHtml(meta.door)}</span>`;
      door.addEventListener('click', () => { ctl.close(); openCreateForm(key); });
      content.appendChild(door);
    });
    ctl = openModal({ title: 'A page for…', contentEl: content });
  }

  function openCreateForm(subjectType) {
    const meta = SUBJECTS[subjectType];
    const content = document.createElement('div');
    content.className = 'mp-form';

    const nameField = meta.nameLabel ? `
      <label class="mp-label">${escapeHtml(meta.nameLabel)}</label>
      <input id="mp-f-name" class="mp-input" maxlength="120" placeholder="${subjectType === 'pet' ? 'Biscuit' : subjectType === 'friend' ? 'their name' : subjectType === 'oc' ? 'Vex' : 'Mr. Darcy'}">` : '';
    content.innerHTML = `
      ${nameField}
      <label class="mp-label">Page title</label>
      <input id="mp-f-title" class="mp-input" maxlength="120" placeholder="${subjectType === 'self' ? '☆ my corner ☆' : 'a page for someone special'}">
      <p class="mp-muted" style="font-size:12.5px;margin-top:8px;">${subjectType === 'friend' || subjectType === 'pet' ? 'Pages about others carry a “made by you, for them” byline.' : subjectType === 'character' ? 'Shrines are fan work — all love, no affiliation.' : 'You can change everything later.'}</p>
    `;

    openModal({
      title: `${meta.emoji} New page — ${meta.door}`,
      contentEl: content,
      actions: [
        { label: 'Cancel' },
        {
          label: 'Create', accent: true,
          async onClick(ctl, btn) {
            const titleEl = content.querySelector('#mp-f-title');
            const nameEl = content.querySelector('#mp-f-name');
            const name = nameEl ? nameEl.value.trim() : '';
            let title = titleEl.value.trim();
            if (!title) title = name ? name : '';
            if (!title) { titleEl.focus(); titleEl.classList.add('mp-input-bad'); return; }
            btn.disabled = true; btn.textContent = 'Creating…';
            try {
              const { page } = await api('/api/pages', {
                method: 'POST',
                body: { title, subject_type: subjectType, subject_name: name || null },
              });
              ctl.close();
              navigate('/edit/' + page.id);
            } catch (err) {
              btn.disabled = false; btn.textContent = 'Create';
              toast(err.message);
            }
          },
        },
      ],
    });
    const first = content.querySelector('input');
    if (first) setTimeout(() => first.focus(), 60);
  }

  window.MP = { api, navigate, escapeHtml, timeAgo, slugify, toast, openModal, SUBJECTS, renderMyPages };

  route();
})();
