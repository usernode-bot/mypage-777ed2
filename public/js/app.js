// MyPage app shell: token plumbing, tiny router, My Pages home, the
// five-door chooser, the FanPages directory, the account-less /make flow
// (local drafts + migration on sign-in), and gift claiming. The editor
// lives in editor.js; page rendering in renderer.js/widgets.js.
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
    const p = location.pathname;
    const m = p.match(/^\/edit\/(\d+)$/);
    if (m) return window.MPEditor.open(parseInt(m[1], 10));
    if (p === '/make' || p === '/make/edit') return makeFlow(p === '/make/edit');
    if (p === '/directory') return renderDirectory();
    renderMyPages();
  }

  // ------------------------------------------------------------ page header

  function header(active) {
    const canMake = !!token;
    return `
      <header class="mp-home-header">
        <div>
          <div class="mp-kicker">your corner of the internet</div>
          <h1 class="mp-wordmark">MyPage</h1>
        </div>
        ${canMake
          ? '<button id="mp-new-btn" class="mp-btn mp-btn-accent">＋ New page</button>'
          : '<a href="/make" data-nav="/make" class="mp-btn mp-btn-accent" style="text-decoration:none;">＋ make your own</a>'}
      </header>
      <nav class="mp-tabs">
        ${token ? `<button class="mp-tab${active === 'mine' ? ' mp-tab-on' : ''}" data-nav="/">My Pages</button>` : ''}
        <button class="mp-tab${active === 'directory' ? ' mp-tab-on' : ''}" data-nav="/directory">Directory</button>
      </nav>`;
  }

  function wireHeader(app) {
    app.querySelectorAll('[data-nav]').forEach((el) => {
      el.addEventListener('click', (e) => { e.preventDefault(); navigate(el.dataset.nav); });
    });
    const newBtn = app.querySelector('#mp-new-btn');
    if (newBtn) newBtn.addEventListener('click', () => openChooser(false));
  }

  // ---------------------------------------------------------------- My Pages

  async function renderMyPages() {
    if (!token) return renderDirectory(); // account-less landing = the gallery
    const app = document.getElementById('app');
    app.innerHTML = header('mine') + `
      <main class="mp-home" data-testid="my-pages">
        <div class="mp-muted" style="padding:24px 4px;">loading your pages…</div>
      </main>`;
    wireHeader(app);

    const main = app.querySelector('main');
    let pages, gifts = [];
    try {
      [{ pages }, { gifts }] = await Promise.all([api('/api/me/pages'), api('/api/me/gifts').catch(() => ({ gifts: [] }))]);
    } catch (err) {
      main.innerHTML = `<div class="mp-muted" style="padding:24px 4px;">Couldn’t load your pages — ${escapeHtml(err.message)}</div>`;
      return;
    }

    main.innerHTML = '';

    // Draft migration (spec §6.7): a local /make draft imports on sign-in.
    const draft = window.MPDraft && MPDraft.load();
    if (draft) main.appendChild(draftBanner(draft));

    if (gifts.length) {
      const label = document.createElement('div');
      label.className = 'mp-sect-label';
      label.textContent = 'Made for me';
      main.appendChild(label);
      gifts.forEach((g) => main.appendChild(giftCard(g)));
    }

    if (!pages.length) {
      const empty = document.createElement('div');
      empty.className = 'mp-empty';
      empty.innerHTML = `
        <div class="mp-empty-art">✨🖼️🐾</div>
        <p><b>No pages yet.</b> Make one — for yourself, your best friend, your dog, your OC, or your comfort character.</p>
        <p class="mp-muted">No feed here. Just your pages.</p>`;
      main.appendChild(empty);
      return;
    }

    const label = document.createElement('div');
    label.className = 'mp-sect-label';
    label.textContent = 'Mine';
    const list = document.createElement('div');
    list.className = 'mp-card-list';
    main.append(label, list);
    pages.forEach((p) => {
      const meta = SUBJECTS[p.subject_type] || SUBJECTS.self;
      const card = document.createElement('button');
      card.className = 'mp-card';
      const status = p.published
        ? `<span class="mp-status-pub">published · /p/${escapeHtml(p.slug)}</span>`
        : `<span class="mp-status-draft">draft</span> · last touched ${escapeHtml(timeAgo(p.updated_at))}`;
      const visits = Number(p.visits) > 0 ? ` · ${Number(p.visits)} visits` : '';
      const pending = p.pending_signs > 0
        ? `<span class="mp-badge">${p.pending_signs} sign${p.pending_signs === 1 ? '' : 's'} to approve</span>` : '';
      const delisted = p.directory_delisted_by_report ? '<span class="mp-badge" style="background:#C0392B;">reported</span>' : '';
      card.innerHTML = `
        <div class="mp-card-row1">
          <span class="mp-card-title">${escapeHtml(p.title)}</span>
          <span class="mp-chip">${meta.emoji} ${escapeHtml(meta.chip)}</span>
        </div>
        <div class="mp-card-row2">${status}${visits} ${pending} ${delisted}</div>`;
      card.addEventListener('click', () => navigate('/edit/' + p.id));
      list.appendChild(card);
    });
    const foot = document.createElement('p');
    foot.className = 'mp-muted';
    foot.style.cssText = 'text-align:center;padding:22px 8px 8px;';
    foot.textContent = 'no feed here — just your pages';
    main.appendChild(foot);
  }

  function draftBanner(draft) {
    const box = document.createElement('div');
    box.className = 'mp-draftbar';
    const text = document.createElement('div');
    text.innerHTML = `<b>✎ You decorated a draft before signing in.</b><br><span class="mp-muted" style="font-size:12.5px;">“${escapeHtml(draft.title)}” is saved on this device — bring it in?</span>`;
    const acts = document.createElement('div');
    acts.className = 'mp-panel-row';
    const imp = document.createElement('button');
    imp.className = 'mp-btn mp-btn-accent mp-btn-sm';
    imp.textContent = 'Import it';
    imp.addEventListener('click', async () => {
      imp.disabled = true;
      try {
        const { page } = await api('/api/pages', {
          method: 'POST',
          body: { title: draft.title, subject_type: draft.subject_type, subject_name: draft.subject_name, content: draft.content },
        });
        MPDraft.clear();
        toast('Draft imported ✓');
        navigate('/edit/' + page.id);
      } catch (err) {
        imp.disabled = false;
        toast(err.message);
      }
    });
    const drop = document.createElement('button');
    drop.className = 'mp-btn mp-btn-sm';
    drop.textContent = 'Discard';
    drop.addEventListener('click', () => { MPDraft.clear(); box.remove(); });
    acts.append(imp, drop);
    box.append(text, acts);
    return box;
  }

  function giftCard(g) {
    const meta = SUBJECTS[g.subject_type] || SUBJECTS.friend;
    const card = document.createElement('button');
    card.className = 'mp-card mp-card-gift';
    card.innerHTML = `
      <div class="mp-card-row1">
        <span class="mp-card-title">🎁 ${escapeHtml(g.title)}</span>
        <span class="mp-chip">${meta.emoji} from ${escapeHtml(g.created_by)}</span>
      </div>
      <div class="mp-card-row2">someone made you a page — claim it</div>`;
    card.addEventListener('click', () => openClaim(g));
    return card;
  }

  function openClaim(g) {
    const content = document.createElement('div');
    content.innerHTML = `<p style="font-size:14.5px;"><b>${escapeHtml(g.created_by)}</b> made “${escapeHtml(g.title)}” for you. Claim it and it’s yours to redecorate from minute one.</p>
      <p class="mp-muted" style="font-size:13px;">Co-own keeps ${escapeHtml(g.created_by)} on the page too; take over makes it fully yours.</p>`;
    const preview = document.createElement('a');
    preview.href = '/claim/' + encodeURIComponent(g.token);
    preview.target = '_blank';
    preview.textContent = 'peek at the page first ↗';
    preview.style.cssText = 'font-size:13px;color:#B03A7C;font-weight:700;';
    content.appendChild(preview);
    const claim = async (mode, ctl, btn) => {
      btn.disabled = true;
      try {
        const res = await api('/api/claims/' + encodeURIComponent(g.token) + '/claim', { method: 'POST', body: { mode } });
        ctl.close();
        toast('It’s yours 🎉');
        navigate('/edit/' + res.page_id);
      } catch (err) {
        btn.disabled = false;
        toast(err.message);
      }
    };
    openModal({
      title: '🎁 a page, for you',
      contentEl: content,
      actions: [
        { label: 'Later' },
        { label: 'Co-own 🤝', onClick: (ctl, btn) => claim('co_own', ctl, btn) },
        { label: 'Take it over 🎨', accent: true, onClick: (ctl, btn) => claim('take_over', ctl, btn) },
      ],
    });
  }

  // --------------------------------------------------------------- directory

  let dirState = { subject: '', order: 'recent' };

  async function renderDirectory() {
    const app = document.getElementById('app');
    app.innerHTML = header('directory') + `
      <main class="mp-home" data-testid="directory">
        <div class="mp-dir-filters">
          <div class="mp-panel-row" id="mp-dir-subjects"></div>
          <div class="mp-panel-row">
            <button id="mp-dir-order" class="mp-chip mp-chip-btn"></button>
          </div>
        </div>
        <div id="mp-dir-grid" class="mp-dir-grid"><div class="mp-muted" style="padding:20px 4px;">wandering the gallery…</div></div>
        <p class="mp-muted" style="text-align:center;padding:20px 8px;font-size:12.5px;">a gallery to wander, not a feed to scroll</p>
      </main>`;
    wireHeader(app);

    const subjectsRow = app.querySelector('#mp-dir-subjects');
    const filters = [['', '✨ everything'], ['self', '🌟 corners'], ['friend', '💌 for friends'], ['pet', '🐾 pets'], ['oc', '🎭 OCs'], ['character', '📚 shrines']];
    filters.forEach(([value, label]) => {
      const b = document.createElement('button');
      b.className = 'mp-chip mp-chip-btn' + (dirState.subject === value ? ' mp-chip-on' : '');
      b.textContent = label;
      b.addEventListener('click', () => {
        dirState.subject = value;
        subjectsRow.querySelectorAll('.mp-chip').forEach((x) => x.classList.remove('mp-chip-on'));
        b.classList.add('mp-chip-on');
        loadDirectory();
      });
      subjectsRow.appendChild(b);
    });
    const orderBtn = app.querySelector('#mp-dir-order');
    const setOrderLabel = () => { orderBtn.textContent = dirState.order === 'shuffle' ? '🎲 serendipity' : '🕐 recent'; };
    setOrderLabel();
    orderBtn.addEventListener('click', () => {
      dirState.order = dirState.order === 'shuffle' ? 'recent' : 'shuffle';
      setOrderLabel();
      loadDirectory();
    });

    loadDirectory();
  }

  async function loadDirectory() {
    const grid = document.getElementById('mp-dir-grid');
    if (!grid) return;
    try {
      const q = new URLSearchParams();
      if (dirState.subject) q.set('subject', dirState.subject);
      q.set('order', dirState.order);
      const { pages } = await api('/api/public/directory?' + q.toString());
      grid.textContent = '';
      if (!pages.length) {
        const none = document.createElement('div');
        none.className = 'mp-muted';
        none.style.cssText = 'padding:26px 4px;text-align:center;';
        none.textContent = 'nothing here yet — be the first to decorate';
        grid.appendChild(none);
        return;
      }
      pages.forEach((p) => grid.appendChild(directoryCard(p)));
    } catch (err) {
      grid.innerHTML = `<div class="mp-muted" style="padding:20px 4px;">${escapeHtml(err.message)}</div>`;
    }
  }

  function directoryCard(p) {
    const meta = SUBJECTS[p.subject_type] || SUBJECTS.self;
    const a = document.createElement('a');
    a.className = 'mp-dir-card';
    a.href = '/p/' + encodeURIComponent(p.slug);
    a.target = '_blank';
    a.rel = 'noopener';

    const preview = document.createElement('div');
    preview.className = 'mp-dir-preview';
    const bg = p.first_section && p.first_section.background;
    const css = window.PageRenderer.bgToCss(bg);
    for (const k in css) preview.style[k] = css[k];
    // sample the section's first text block for a titled peek
    const firstText = p.first_section && Array.isArray(p.first_section.blocks)
      ? p.first_section.blocks.find((b) => b && b.type === 'text') : null;
    const peek = document.createElement('span');
    peek.className = 'mp-dir-peek';
    if (firstText && firstText.props) {
      peek.textContent = String(firstText.props.text || '').slice(0, 40);
      peek.style.fontFamily = window.PageRenderer.FONTS[firstText.props.font] || '';
      peek.style.color = window.PageRenderer.safeColor(firstText.props.color, '#1F2B47');
    } else {
      peek.textContent = p.title;
    }
    preview.appendChild(peek);

    const info = document.createElement('div');
    info.className = 'mp-dir-info';
    const title = document.createElement('div');
    title.className = 'mp-dir-title';
    title.textContent = p.title;
    const sub = document.createElement('div');
    sub.className = 'mp-dir-sub';
    sub.textContent = `${meta.emoji} ${meta.chip}` + (Number(p.visits) > 0 ? ` · ${p.visits} visits` : '');
    info.append(title, sub);
    a.append(preview, info);
    return a;
  }

  // -------------------------------------------------- /make (account-less)

  // The no-login ladder's strong rung: the full editor with no account,
  // saving a local draft. The chooser is the landing; publishing asks for
  // the account (editor.js handles that moment).
  function makeFlow(editing) {
    const draft = window.MPDraft && MPDraft.load();
    if (editing && draft) return window.MPEditor.open('local');

    const app = document.getElementById('app');
    app.innerHTML = `
      <main class="mp-make" data-testid="make-start">
        <div class="mp-kicker" style="text-align:center;">no account needed to decorate</div>
        <h1 class="mp-wordmark" style="text-align:center;font-size:34px;">make your own</h1>
        <p class="mp-muted" style="text-align:center;max-width:340px;margin:6px auto 20px;">a small loud page — for yourself, a friend, your pet, your OC, or your comfort character. it saves on this device; an account only matters when you publish.</p>
        <div class="mp-doors" id="mp-make-doors"></div>
        <div id="mp-make-resume"></div>
        <p style="text-align:center;margin-top:26px;"><a href="/directory" data-nav="/directory" style="color:#B03A7C;font-weight:700;font-size:13.5px;">or wander the directory →</a></p>
      </main>`;
    app.querySelectorAll('[data-nav]').forEach((el) => {
      el.addEventListener('click', (e) => { e.preventDefault(); navigate(el.dataset.nav); });
    });

    if (draft) {
      const resume = document.createElement('button');
      resume.className = 'mp-btn mp-btn-accent';
      resume.style.cssText = 'display:block;margin:18px auto 0;';
      resume.textContent = `✎ keep decorating “${draft.title}”`;
      resume.addEventListener('click', () => navigate('/make/edit'));
      app.querySelector('#mp-make-resume').appendChild(resume);
    }

    const doors = app.querySelector('#mp-make-doors');
    Object.entries(SUBJECTS).forEach(([key, meta]) => {
      const door = document.createElement('button');
      door.className = 'mp-door';
      door.innerHTML = `<span class="mp-door-emoji">${meta.emoji}</span><span>${escapeHtml(meta.door)}</span>`;
      door.addEventListener('click', () => openCreateForm(key, true));
      doors.appendChild(door);
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
      door.addEventListener('click', () => { ctl.close(); openCreateForm(key, false); });
      content.appendChild(door);
    });
    ctl = openModal({ title: 'A page for…', contentEl: content });
  }

  function openCreateForm(subjectType, local) {
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
            if (local) {
              MPDraft.save({
                title, subject_type: subjectType, subject_name: name || null,
                content: {
                  version: 1, cursor: null, song: null, footerStyle: null,
                  sections: [{
                    id: 's-' + Math.random().toString(36).slice(2, 8),
                    minHeight: 480,
                    background: { type: 'gradient', from: '#FDF3F9', to: '#EFE7FB', angle: 160 },
                    blocks: [{
                      id: 'b-' + Math.random().toString(36).slice(2, 8),
                      type: 'text', x: 8, y: 56, w: 84, rotation: -2, z: 1,
                      props: { text: title, font: 'fraunces', size: 34, color: '#1F2B47', bold: true, align: 'left', style: 'none' },
                    }],
                  }],
                },
              });
              ctl.close();
              navigate('/make/edit');
              return;
            }
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
