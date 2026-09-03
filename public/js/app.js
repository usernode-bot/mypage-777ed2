// MyPage app shell: token plumbing, tiny router, the Home welcome screen,
// the Templates gallery (accurate scaled previews), My Pages, Discover
// (the directory), the account-less /make flow (local drafts + migration
// on sign-in), and gift claiming. The editor lives in editor.js; page
// rendering in renderer.js/widgets.js.
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

  // Simple line icons for the shell chrome (no emoji icons in nav/buttons —
  // emoji stay welcome inside page content and pickers). App-authored SVG.
  const MPIcons = (() => {
    const svg = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
    return {
      home: svg('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>'),
      templates: svg('<rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/>'),
      plus: svg('<path d="M12 5v14M5 12h14"/>'),
      discover: svg('<circle cx="12" cy="12" r="9"/><path d="m14.9 9.1-1.7 4.1-4.1 1.7 1.7-4.1z"/>'),
      pages: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>'),
      help: svg('<circle cx="12" cy="12" r="9"/><path d="M9.8 9.4a2.4 2.4 0 1 1 3.7 2c-.8.6-1.3 1-1.3 1.9"/><circle cx="12" cy="16.6" r=".8" fill="currentColor" stroke="none"/>'),
    };
  })();

  // Minimal modal used everywhere (own implementation so the app has no
  // hard dependency on the hosted kit being reachable). Every dialog gets
  // an explicit ✕ close button so pickers never feel stuck.
  function openModal({ title, contentEl, actions = [], onClose }) {
    const backdrop = document.createElement('div');
    backdrop.className = 'mp-backdrop';
    const modal = document.createElement('div');
    modal.className = 'mp-modal';
    const ctl = {
      el: modal,
      close() {
        backdrop.remove();
        if (onClose) onClose();
      },
    };
    const x = document.createElement('button');
    x.className = 'mp-modal-x';
    x.setAttribute('aria-label', 'Close');
    x.textContent = '✕';
    x.addEventListener('click', () => ctl.close());
    modal.appendChild(x);
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

  // ---------------------------------------------------------------- catalog

  // The shell needs the catalog (template docs + sticker art) for accurate
  // previews on Home / Templates / Discover. Cached for the session; also
  // primes the renderer's sticker map.
  let shellCatalog = null;
  let shellCatalogPromise = null;
  function loadCatalog() {
    if (shellCatalog) return Promise.resolve(shellCatalog);
    if (!shellCatalogPromise) {
      shellCatalogPromise = api('/api/public/catalog').then((cat) => {
        shellCatalog = cat;
        window.PageRenderer.setCatalog(cat);
        return cat;
      }).catch((err) => { shellCatalogPromise = null; throw err; });
    }
    return shellCatalogPromise;
  }

  function featuredTemplates(cat) {
    return (cat.templates || []).filter((t) => t.featured && t.content);
  }

  // ------------------------------------------------------ template previews

  // Accurate miniature: the template's REAL doc rendered through the shared
  // PageRenderer at page width (720px), then scaled to fit the card. Never
  // an illustration or a placeholder.
  function templatePreview(content, opts = {}) {
    const thumb = document.createElement('div');
    thumb.className = 'mp-tpl-thumb';
    if (opts.height) thumb.style.height = opts.height + 'px';
    const scaler = document.createElement('div');
    scaler.className = 'mp-tpl-scaler';
    thumb.appendChild(scaler);
    try {
      window.PageRenderer.render(content, scaler, { editing: true, visits: 128 });
    } catch { /* a malformed doc must never break the gallery */ }
    // Scale two frames later: the renderer refits section heights on the
    // next frame, and measuring after that keeps the mini layout faithful.
    // maxScale keeps wide cards honest miniatures (centered when capped)
    // instead of near-1:1 crops.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const w = thumb.clientWidth;
      if (!w) return;
      const k = Math.min(w / 720, opts.maxScale || 1);
      scaler.style.transform = 'scale(' + k + ')';
      scaler.style.left = Math.max(0, (w - 720 * k) / 2) + 'px';
    }));
    return thumb;
  }

  // Full-screen preview of the real template (Templates screen).
  function openTemplateFullPreview(t) {
    const overlay = document.createElement('div');
    overlay.className = 'mp-fullpreview';
    const bar = document.createElement('div');
    bar.className = 'mp-fullpreview-bar';
    const back = document.createElement('button');
    back.className = 'mp-iconbtn';
    back.setAttribute('aria-label', 'Close preview');
    back.textContent = '✕';
    back.addEventListener('click', () => overlay.remove());
    const title = document.createElement('div');
    title.className = 'mp-fullpreview-title';
    title.textContent = t.name;
    const use = document.createElement('button');
    use.className = 'mp-btn mp-btn-accent mp-btn-sm';
    use.textContent = 'Use template';
    use.addEventListener('click', () => { overlay.remove(); openUseTemplate(t); });
    bar.append(back, title, use);
    const mount = document.createElement('div');
    overlay.append(bar, mount);
    document.body.appendChild(overlay);
    window.PageRenderer.render(t.content, mount, {
      editing: true, visits: 128, footer: true, footerStyle: t.content.footerStyle,
    });
  }

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
    if (p === '/directory' || p === '/discover') return renderDirectory();
    const td = p.match(/^\/templates\/([a-z0-9-]{1,40})$/);
    if (td) return renderTemplateDetail(td[1]);
    if (p === '/templates') return renderTemplates();
    if (p === '/pages') return renderMyPages();
    renderHome();
  }

  // Screenshot-state deep link: the editor's chrome can't be reached by
  // navigation (the seeded demo pages belong to another user), so
  // /make?shot=editor drops a FIXED demo document into an in-memory draft
  // and opens the account-less editor on it. Deliberately ephemeral — a
  // persisted draft would plant a phantom "keep decorating" banner for
  // anyone who follows the link. No DB writes, so it works in every env.
  const SHOT_DOC = {
    version: 1, cursor: null, song: null, footerStyle: null,
    sections: [{
      id: 's-shot01',
      minHeight: 480,
      background: { type: 'gradient', from: '#FDF3F9', to: '#EFE7FB', angle: 160 },
      blocks: [
        {
          id: 'b-shot01', type: 'text', x: 8, y: 56, w: 84, rotation: -2, z: 1,
          props: { text: 'Staging demo draft', font: 'fraunces', size: 34, color: '#1F2B47', bold: true, align: 'left', style: 'none' },
        },
        {
          id: 'b-shot02', type: 'text', x: 10, y: 150, w: 76, rotation: 1, z: 2,
          props: { text: 'decorating in the dark ✨', font: 'hand', size: 26, color: '#6B4E9E', bold: false, align: 'left', style: 'none' },
        },
      ],
    }],
  };

  function shotEditor() {
    if (!window.MPDraft || !MPDraft.setEphemeral) return false;
    MPDraft.setEphemeral({
      title: 'Staging demo draft', subject_type: 'self', subject_name: null, content: SHOT_DOC,
    });
    navigate('/make/edit', true);
    return true;
  }

  // ------------------------------------------------------------- appearance

  // The appearance control: one round chip in the app's own header. The
  // editor puts it in the ⋯ menu instead — its top bar is already full.
  // Icon shows what's IN EFFECT, not what's chosen.
  function themeButton() {
    const emoji = window.MPTheme ? MPTheme.LABELS[MPTheme.resolved()].emoji : '☀️';
    return `<button id="mp-theme-btn" class="mp-themebtn un-touch-target" data-testid="theme-toggle"
      aria-label="Appearance" title="Appearance">${emoji}</button>`;
  }

  function wireThemeButton(scope) {
    const btn = (scope || document).querySelector('#mp-theme-btn');
    if (btn) btn.addEventListener('click', () => openAppearance());
  }

  function openAppearance() {
    const content = document.createElement('div');
    const doors = document.createElement('div');
    doors.className = 'mp-doors';
    let ctl;
    const current = MPTheme.mode();
    ['light', 'dark', 'system'].forEach((m) => {
      const meta = MPTheme.LABELS[m];
      const door = document.createElement('button');
      door.className = 'mp-door' + (current === m ? ' mp-door-on' : '');
      door.dataset.themeMode = m;
      door.innerHTML = `<span class="mp-door-emoji">${meta.emoji}</span><span>${meta.name}</span>`;
      door.addEventListener('click', () => {
        MPTheme.set(m);
        ctl.close();
        toast(m === 'system' ? 'Following your device' : m === 'dark' ? 'Dark mode on' : 'Light mode on');
      });
      doors.appendChild(door);
    });
    const note = document.createElement('p');
    note.className = 'mp-muted';
    note.style.cssText = 'font-size:12.5px;margin:12px 2px 0;';
    note.textContent = 'System follows your phone or computer’s own light/dark setting. Pages you make keep their own colours either way.';
    content.append(doors, note);
    ctl = openModal({ title: '🌗 Appearance', contentEl: content, actions: [{ label: 'Close' }] });
  }

  // Re-label in place so a live OS change (or a pick) doesn't need a re-render.
  if (window.MPTheme) {
    MPTheme.subscribe((resolvedTheme) => {
      const btn = document.getElementById('mp-theme-btn');
      if (btn) btn.textContent = MPTheme.LABELS[resolvedTheme].emoji;
    });
  }

  // -------------------------------------------------- header + bottom nav

  function header() {
    return `
      <header class="mp-home-header">
        <h1 class="mp-wordmark">MyPage</h1>
        <div class="mp-home-actions">
          <button id="mp-help-btn" class="mp-helpbtn un-touch-target" data-testid="help-assistant-btn"
            aria-label="Help assistant" title="Help assistant">${MPIcons.help}</button>
          ${themeButton()}
        </div>
      </header>`;
  }

  // Persistent bottom navigation: Home · Templates · Create · Discover ·
  // Pages. Create is the emphasized center button. Shown on the four shell
  // screens only — never inside the editor or the public view.
  function bottomNav(active) {
    const item = (key, label, path) => `
      <button class="mp-nav-item${active === key ? ' mp-nav-on' : ''}" data-nav="${path}" aria-label="${label}">
        ${MPIcons[key]}<span>${label}</span><span class="mp-nav-dot"></span>
      </button>`;
    return `
      <nav class="mp-bottomnav" data-testid="bottom-nav">
        ${item('home', 'Home', '/')}
        ${item('templates', 'Templates', '/templates')}
        <button class="mp-nav-create" id="mp-nav-create" aria-label="Create a page">${MPIcons.plus}</button>
        ${item('discover', 'Discover', '/directory')}
        ${item('pages', 'Pages', '/pages')}
      </nav>`;
  }

  function wireShell(app) {
    app.querySelectorAll('[data-nav]').forEach((el) => {
      el.addEventListener('click', (e) => { e.preventDefault(); navigate(el.dataset.nav); });
    });
    wireThemeButton(app);
    wireHelpAssistantButton(app);
    const create = app.querySelector('#mp-nav-create');
    // Create opens the Templates gallery — its first card is "Start blank".
    if (create) create.addEventListener('click', () => navigate('/templates'));
  }

  function wireHelpAssistantButton(scope) {
    const btn = (scope || document).querySelector('#mp-help-btn');
    if (btn) btn.addEventListener('click', openHelpAssistant);
  }

  function openHelpAssistant() {
    const tips = {
      start: 'Start with Templates. Pick one, then tap Use template to open the editor.',
      publish: 'In the editor, open Save and choose Publish. Your page gets a public /p/<slug> link.',
      song: 'In the editor toolbar, open Song. Search, preview, then save it to your page.',
      gift: 'Open My Pages, choose a page, then tap Gift. Share the claim link with your friend.',
    };
    const content = document.createElement('div');
    content.className = 'mp-help-assistant';
    content.innerHTML = `
      <p class="mp-muted" style="margin:0 0 10px;">Hi, I am your MyPage helper. Pick a topic and I will point you to the right screen.</p>
      <div class="mp-help-topics">
        <button class="mp-chip mp-chip-btn" data-help-topic="start">How do I start?</button>
        <button class="mp-chip mp-chip-btn" data-help-topic="publish">How do I publish?</button>
        <button class="mp-chip mp-chip-btn" data-help-topic="song">How do I add a song?</button>
        <button class="mp-chip mp-chip-btn" data-help-topic="gift">How do I gift a page?</button>
      </div>
      <p id="mp-help-answer" class="mp-help-answer">Tip: pick a question above.</p>`;

    const ctl = openModal({
      title: 'Help assistant',
      contentEl: content,
      actions: [{ label: 'Close' }],
    });

    const answer = content.querySelector('#mp-help-answer');
    content.querySelectorAll('[data-help-topic]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-help-topic');
        answer.textContent = tips[key] || 'Tip unavailable right now.';
      });
    });
    return ctl;
  }

  // -------------------------------------------------------------------- home

  // Card thumbnails for the flagship templates: final reference images
  // provided by the owner, committed as static assets and used verbatim
  // (cropped, never redrawn). Templates without one fall back to the
  // accurate scaled live preview.
  const TPL_IMAGES = {
    'scene-page': '/img/tpl-scene.jpg',
    'bestie-page': '/img/tpl-bestie.jpg',
    'y2k-page': '/img/tpl-y2k.jpg',
  };

  // ------------------------------------------------- template detail pages

  // Detail-page content for the flagship templates, faithful to the owner's
  // mockups: wordmark treatment, tagline, how-it-works strip, the exact
  // artwork inside a retro browser frame, recap + reassurance line. The
  // hero is always the committed mockup crop — never a live re-render.
  // (Pet Fan Page has no mockup yet: same shell, live miniature hero.)
  const TPL_DETAILS = {
    'scene-page': {
      name: 'Scene Page',
      wordmarkHtml: '<h2 class="mp-td-wordmark mp-td-wm-serif"><span class="mp-td-wm-deco">✦</span>Scene Page<span class="mp-td-wm-deco">✧</span></h2>',
      tagline: 'Upload a real place and make it yours.',
      address: 'yourspace.scene',
      hero: '/img/detail-scene.jpg',
      numbered: false,
      steps: [
        { icon: '☁️', title: 'Upload', sub: 'Add a photo of your space' },
        { icon: '✨', title: 'Recreate', sub: 'We turn it into your scene' },
        { icon: '🙂', title: 'Make it Yours', sub: 'Add widgets, styles, & more' },
      ],
      recap: [
        { title: 'Upload Your Scene Photo', sub: 'Drag & drop or click to upload' },
        { title: 'We’ll recreate it', sub: 'in your style with starter widgets' },
        { title: 'You make it yours', sub: 'add, move, and customize anything' },
      ],
      foot: 'Fully customizable · Easy to edit · Yours forever',
    },
    'bestie-page': {
      name: 'Bestie Page',
      wordmarkHtml: '<h2 class="mp-td-wordmark mp-td-wm-serif"><span class="mp-td-wm-deco mp-td-wm-heart">♡</span>Bestie Page<span class="mp-td-wm-deco">✦</span></h2>',
      tagline: 'Like a burned CD, but as a page.',
      address: 'yourspace.scene',
      hero: '/img/detail-bestie.jpg',
      numbered: true,
      steps: [
        { title: 'Pick a photo', sub: 'Start with your favorite pic' },
        { title: 'Customize your favorites', sub: 'Add the good stuff' },
        { title: 'Gift it to your friend', sub: 'Share the love' },
      ],
      recap: [
        { title: 'Start with a photo', sub: 'Upload your fave pic (or use ours)' },
        { title: 'Add your memories + favorites', sub: 'Drop in songs, quotes, photos and everything in between' },
        { title: 'Gift your page', sub: 'Share a link or send it as a gift' },
      ],
      foot: 'Fully customizable · Easy to edit · Yours forever',
    },
    'y2k-page': {
      name: 'Y2K Personal Page',
      wordmarkHtml: '<h2 class="mp-td-wordmark mp-td-wm-y2k">Y2K<span class="mp-td-wm-deco">✦</span></h2><div class="mp-td-wm-sub">personal page</div><span class="mp-td-pill">template builder ♡</span>',
      tagline: 'Your own desktop-era corner.',
      address: 'yourpage.y2k',
      hero: '/img/detail-y2k.jpg',
      numbered: true,
      steps: [
        { title: 'Pick a photo', sub: 'Upload your pic. This is your space.' },
        { title: 'Add your faves', sub: 'Drop in widgets for music, movies, moods + more.' },
        { title: 'Make it yours', sub: 'Customize everything until it feels so you.' },
      ],
      recap: [
        { title: '1. Upload your photo', sub: 'Make it yours. Your photo is the heart of your page.' },
        { title: '2. Drop in widgets', sub: 'Add music, movies, GIFs, moods, links & more.' },
        { title: '3. Customize anything', sub: 'Move, resize, edit, and style until it’s so you.' },
      ],
      foot: 'It’s your world. Make it iconic. 💗',
    },
    'pet-fan-page': {
      name: 'Pet Fan Page',
      wordmarkHtml: '<h2 class="mp-td-wordmark mp-td-wm-serif"><span class="mp-td-wm-deco">🐾</span>Pet Fan Page<span class="mp-td-wm-deco">✦</span></h2>',
      tagline: 'For your favorite little icon.',
      address: 'theicon.page',
      hero: null, // no owner mockup yet — live miniature of the real doc
      numbered: true,
      steps: [
        { title: 'Add their portrait', sub: 'Replace it with your pet’s best photo' },
        { title: 'Fill the lists', sub: 'Nicknames, snacks, moods + more' },
        { title: 'Share the fan club', sub: 'Publish and pass the link around' },
      ],
      recap: [
        { title: 'Start with their best photo', sub: 'The portrait is the heart of the page' },
        { title: 'Make the lists theirs', sub: 'Nicknames, favorite snacks, funniest moment' },
        { title: 'Open the fan club', sub: 'Publish and let people sign the notes' },
      ],
      foot: 'Fully customizable · Easy to edit · Yours forever',
    },
  };

  async function renderTemplateDetail(key) {
    const det = TPL_DETAILS[key];
    if (!det) return navigate('/templates', true);
    const app = document.getElementById('app');
    const stepHtml = det.steps.map((st, i) => `
      <div class="mp-td-step">
        <span class="mp-td-step-badge${det.numbered ? ' mp-td-step-num' : ''}">${det.numbered ? i + 1 : st.icon}</span>
        <div class="mp-td-step-txt"><b>${escapeHtml(st.title)}</b><span>${escapeHtml(st.sub)}</span></div>
      </div>`).join('<span class="mp-td-arrow" aria-hidden="true">→</span>');
    const recapHtml = det.recap.map((r) => `
      <div class="mp-td-recap-row"><b>${escapeHtml(r.title)}</b><span>${escapeHtml(r.sub)}</span></div>`).join('');
    app.innerHTML = header() + `
      <main class="mp-home mp-has-nav mp-td" data-testid="template-detail">
        <button class="mp-td-back" data-nav="/templates">← All templates</button>
        <header class="mp-td-head">
          ${det.wordmarkHtml}
          <div class="mp-td-tagline">${escapeHtml(det.tagline)}</div>
        </header>
        <div class="mp-td-steps">${stepHtml}</div>
        <div class="mp-td-browser">
          <div class="mp-td-bbar">
            <span class="mp-td-dot" style="background:#FF6B57"></span>
            <span class="mp-td-dot" style="background:#FFE93F"></span>
            <span class="mp-td-dot" style="background:#7FB542"></span>
            <span class="mp-td-url">🔒 ${escapeHtml(det.address)}</span>
          </div>
          <div class="mp-td-hero" id="mp-td-hero"></div>
        </div>
        <div class="mp-td-recap">${recapHtml}</div>
        <p class="mp-td-foot">${escapeHtml(det.foot)}</p>
        <div class="mp-td-ctabar">
          <button class="mp-btn mp-btn-accent mp-td-cta" id="mp-td-use" data-testid="use-template-cta">Use This Template ✨</button>
        </div>
      </main>` + bottomNav('templates');
    wireShell(app);

    const heroMount = document.getElementById('mp-td-hero');
    if (det.hero) {
      // The exact mockup artwork, committed as a static asset — never a
      // live re-render of the starter doc.
      const img = document.createElement('img');
      img.src = det.hero;
      img.alt = det.name + ' template';
      img.draggable = false;
      heroMount.appendChild(img);
    }

    let tplRow = null;
    try {
      const cat = await loadCatalog();
      tplRow = (cat.templates || []).find((t) => t.key === key) || null;
      if (!det.hero && heroMount && tplRow && tplRow.content) {
        heroMount.appendChild(templatePreview(tplRow.content, { height: 430, maxScale: 0.62 }));
      }
    } catch { /* CTA falls back to the gallery */ }
    const use = document.getElementById('mp-td-use');
    if (use) use.addEventListener('click', () => {
      if (tplRow && tplRow.content) openUseTemplate(tplRow);
      else navigate('/templates');
    });
  }

  async function renderHome() {
    const app = document.getElementById('app');
    app.innerHTML = header() + `
      <main class="mp-home mp-has-nav" data-testid="home">
        <section class="mp-hero" data-testid="home-hero">
          <h2 class="mp-hero-title">Make a page</h2>
          <p class="mp-hero-sub">For yourself, a friend, or your pet.</p>
          <div class="mp-hero-acts">
            <button class="mp-btn mp-btn-accent" data-nav="/templates">Start with a template →</button>
            <button class="mp-link-quiet" data-nav="/templates">Browse templates</button>
          </div>
        </section>
        <h3 class="mp-h2">Start with a template</h3>
        <div id="mp-home-carousel" class="mp-carousel" data-testid="home-carousel"></div>
        <div id="mp-home-mine"></div>
        <div id="mp-home-public"></div>
      </main>` + bottomNav('home');
    wireShell(app);

    // Signed in with pages already? Keep home useful after day one.
    if (token) {
      api('/api/me/pages').then(({ pages }) => {
        if (!pages.length) return;
        const mount = document.getElementById('mp-home-mine');
        if (!mount) return;
        const label = document.createElement('h3');
        label.className = 'mp-h2';
        label.textContent = 'Your pages';
        mount.appendChild(label);
        pages.slice(0, 3).forEach((p) => mount.appendChild(myPageCard(p)));
        if (pages.length > 3) {
          const all = document.createElement('button');
          all.className = 'mp-link-quiet';
          all.textContent = 'All your pages →';
          all.addEventListener('click', () => navigate('/pages'));
          mount.appendChild(all);
        }
      }).catch(() => {});
    }

    // Public pages: a small taste of the directory, right below your own
    // pages. Same cards as Discover; catalog first so previews have art.
    Promise.all([
      api('/api/public/directory'),
      loadCatalog().catch(() => null),
    ]).then(([{ pages }]) => {
      const mount = document.getElementById('mp-home-public');
      if (!mount || !pages.length) return;
      const label = document.createElement('h3');
      label.className = 'mp-h2';
      label.textContent = 'Public pages';
      const grid = document.createElement('div');
      grid.className = 'mp-dir-grid';
      grid.dataset.testid = 'home-public-pages';
      pages.slice(0, 4).forEach((p) => grid.appendChild(directoryCard(p)));
      const all = document.createElement('button');
      all.className = 'mp-link-quiet';
      all.textContent = 'Wander Discover →';
      all.addEventListener('click', () => navigate('/directory'));
      mount.append(label, grid, all);
    }).catch(() => {});

    // Template carousel: image-first cards. Tapping one opens the real
    // template full-screen with its "Use template" action.
    try {
      const cat = await loadCatalog();
      const carousel = document.getElementById('mp-home-carousel');
      if (!carousel) return;
      carousel.textContent = '';
      featuredTemplates(cat).forEach((t) => {
        const tile = document.createElement('button');
        tile.className = 'mp-tpl-tile';
        const imgWrap = document.createElement('div');
        imgWrap.className = 'mp-tpl-tile-img';
        if (TPL_IMAGES[t.key]) {
          const img = document.createElement('img');
          img.src = TPL_IMAGES[t.key];
          img.alt = t.name;
          img.loading = 'lazy';
          img.draggable = false;
          imgWrap.appendChild(img);
        } else {
          const prev = templatePreview(t.content, { height: 312 });
          prev.style.height = '100%';
          imgWrap.appendChild(prev);
        }
        const name = document.createElement('div');
        name.className = 'mp-tpl-tile-name';
        name.textContent = t.name;
        const tag = document.createElement('div');
        tag.className = 'mp-tpl-tile-tag';
        tag.textContent = t.tagline || t.description || '';
        tile.append(imgWrap, name, tag);
        // Flagship templates open their faithful detail page — never the
        // live-rendered starter doc, which reads as a bait-and-switch.
        tile.addEventListener('click', () => {
          if (TPL_DETAILS[t.key]) navigate('/templates/' + t.key);
          else openTemplateFullPreview(t);
        });
        carousel.appendChild(tile);
      });
    } catch (err) {
      const carousel = document.getElementById('mp-home-carousel');
      if (carousel) carousel.innerHTML = `<div class="mp-muted" style="padding:10px 4px;font-size:13px;">${escapeHtml(err.message)}</div>`;
    }
  }

  // --------------------------------------------------------------- templates

  let tplState = { q: '', filter: 'all' };

  const TPL_FILTERS = [
    ['all', 'All'], ['scene', 'Scene'], ['bestie', 'Bestie'],
    ['y2k', 'Y2K'], ['pets', 'Pets'], ['styles', 'Styles'],
  ];

  function templateMatchesFilter(t, filter) {
    switch (filter) {
      case 'scene': return t.key === 'scene-page';
      case 'bestie': return t.key === 'bestie-page';
      case 'y2k': return t.key === 'y2k-page' || t.key === 'y2k';
      case 'pets': return t.key === 'pet-fan-page' || t.subject_type === 'pet';
      case 'styles': return !t.featured;
      default: return true;
    }
  }

  async function renderTemplates() {
    const app = document.getElementById('app');
    app.innerHTML = header() + `
      <main class="mp-home mp-has-nav" data-testid="templates">
        <section class="mp-hero" style="padding-bottom:0;">
          <h2 class="mp-hero-title" style="font-size:30px;">Start with a template.</h2>
          <p class="mp-hero-sub">Pick a starting point, then make it completely yours.</p>
        </section>
        <input id="mp-tpl-search" class="mp-search" type="search" placeholder="Search templates…" value="${escapeHtml(tplState.q)}">
        <div class="mp-panel-row" id="mp-tpl-filters" style="margin-bottom:12px;"></div>
        <div id="mp-tpl-list"></div>
      </main>` + bottomNav('templates');
    wireShell(app);

    const filterRow = app.querySelector('#mp-tpl-filters');
    TPL_FILTERS.forEach(([key, label]) => {
      const b = document.createElement('button');
      b.className = 'mp-chip mp-chip-btn' + (tplState.filter === key ? ' mp-pill-on' : '');
      b.textContent = label;
      b.addEventListener('click', () => {
        tplState.filter = key;
        filterRow.querySelectorAll('.mp-chip').forEach((x) => x.classList.remove('mp-pill-on'));
        b.classList.add('mp-pill-on');
        renderTemplateList();
      });
      filterRow.appendChild(b);
    });

    let searchTimer = null;
    app.querySelector('#mp-tpl-search').addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        tplState.q = e.target.value.trim().toLowerCase();
        renderTemplateList();
      }, 150);
    });

    try { await loadCatalog(); } catch (err) {
      app.querySelector('#mp-tpl-list').innerHTML = `<div class="mp-muted" style="padding:20px 4px;">${escapeHtml(err.message)}</div>`;
      return;
    }
    renderTemplateList();
  }

  function renderTemplateList() {
    const list = document.getElementById('mp-tpl-list');
    if (!list || !shellCatalog) return;
    list.textContent = '';

    // "Start blank" leads the gallery — the classic chooser path unchanged.
    if (tplState.filter === 'all' && !tplState.q) {
      const blank = document.createElement('button');
      blank.className = 'mp-tpl-card';
      blank.setAttribute('data-testid', 'start-blank');
      blank.innerHTML = `
        <div class="mp-tpl-body" style="padding-top:16px;">
          <div class="mp-tpl-name">Start blank</div>
          <div class="mp-tpl-desc">An empty canvas — pick who it’s for and decorate from scratch.</div>
          <span class="mp-btn mp-btn-quiet mp-btn-sm">Start blank</span>
        </div>`;
      blank.addEventListener('click', () => {
        if (token) openChooser();
        else navigate('/make');
      });
      list.appendChild(blank);
    }

    const q = tplState.q;
    const matches = (shellCatalog.templates || []).filter((t) => {
      if (!t.content) return false;
      if (!templateMatchesFilter(t, tplState.filter)) return false;
      if (!q) return true;
      return [t.name, t.description, t.tagline].some((s) => typeof s === 'string' && s.toLowerCase().includes(q));
    });
    // Featured first, matching the catalog's own ordering promise.
    matches.sort((a, b) => (b.featured === true) - (a.featured === true));

    if (!matches.length) {
      const none = document.createElement('div');
      none.className = 'mp-muted';
      none.style.cssText = 'padding:24px 4px;text-align:center;';
      none.textContent = 'no templates match — try another word';
      list.appendChild(none);
      return;
    }

    matches.forEach((t, i) => {
      const card = document.createElement('div');
      card.className = 'mp-tpl-card';
      if (t.featured && i === 0) card.setAttribute('data-testid', 'featured-template');
      const openDetail = () => {
        if (TPL_DETAILS[t.key]) navigate('/templates/' + t.key);
        else openTemplateFullPreview(t);
      };
      const thumb = templatePreview(t.content, { height: 210, maxScale: 0.42 });
      thumb.addEventListener('click', openDetail);
      card.appendChild(thumb);
      const body = document.createElement('div');
      body.className = 'mp-tpl-body';
      const name = document.createElement('div');
      name.className = 'mp-tpl-name';
      name.textContent = t.name;
      const desc = document.createElement('div');
      desc.className = 'mp-tpl-desc';
      desc.textContent = t.tagline || t.description || '';
      const acts = document.createElement('div');
      acts.className = 'mp-tpl-acts';
      const use = document.createElement('button');
      use.className = 'mp-btn mp-btn-accent mp-btn-sm';
      use.textContent = 'Use template';
      use.addEventListener('click', () => openUseTemplate(t));
      const peek = document.createElement('button');
      peek.className = 'mp-btn mp-btn-quiet mp-btn-sm';
      peek.textContent = 'Preview';
      peek.addEventListener('click', openDetail);
      acts.append(use, peek);
      body.append(name, desc, acts);
      card.appendChild(body);
      list.appendChild(card);
    });
  }

  // "Use template" asks only the minimum: who it's for (prefilled per
  // template) and a title — then straight into the editor, fully applied.
  function openUseTemplate(t) {
    const subject = SUBJECTS[t.subject_type] ? t.subject_type : 'self';
    openCreateForm(subject, !token, { template: t });
  }

  // ---------------------------------------------------------------- My Pages

  async function renderMyPages() {
    if (!token) return navigate('/make', true); // account-less: go decorate
    const app = document.getElementById('app');
    app.innerHTML = header() + `
      <main class="mp-home mp-has-nav" data-testid="my-pages">
        <div class="mp-muted" style="padding:24px 4px;">loading your pages…</div>
      </main>` + bottomNav('pages');
    wireShell(app);

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
      const start = document.createElement('button');
      start.className = 'mp-btn mp-btn-accent';
      start.textContent = 'Create a page';
      start.addEventListener('click', () => navigate('/templates'));
      empty.appendChild(start);
      main.appendChild(empty);
      return;
    }

    const label = document.createElement('div');
    label.className = 'mp-sect-label';
    label.textContent = 'Mine';
    const list = document.createElement('div');
    list.className = 'mp-card-list';
    main.append(label, list);
    pages.forEach((p) => list.appendChild(myPageCard(p)));
    const foot = document.createElement('p');
    foot.className = 'mp-muted';
    foot.style.cssText = 'text-align:center;padding:22px 8px 8px;';
    foot.textContent = 'no feed here — just your pages';
    main.appendChild(foot);
  }

  function myPageCard(p) {
    const meta = SUBJECTS[p.subject_type] || SUBJECTS.self;
    const card = document.createElement('button');
    card.className = 'mp-card';
    const status = p.published
      ? `<span class="mp-status-pub">published · /p/${escapeHtml(p.slug)}</span>`
      : `<span class="mp-status-draft">draft</span> · last touched ${escapeHtml(timeAgo(p.updated_at))}`;
    const visits = Number(p.visits) > 0 ? ` · ${Number(p.visits)} visits` : '';
    const pending = p.pending_signs > 0
      ? `<span class="mp-badge">${p.pending_signs} sign${p.pending_signs === 1 ? '' : 's'} to approve</span>` : '';
    const delisted = p.directory_delisted_by_report ? '<span class="mp-badge mp-badge-danger">reported</span>' : '';
    card.innerHTML = `
      <div class="mp-card-row1">
        <span class="mp-card-title">${escapeHtml(p.title)}</span>
        <span class="mp-chip">${meta.emoji} ${escapeHtml(meta.chip)}</span>
      </div>
      <div class="mp-card-row2">${status}${visits} ${pending} ${delisted}</div>`;
    card.addEventListener('click', () => navigate('/edit/' + p.id));
    return card;
  }

  function draftBanner(draft) {
    const box = document.createElement('div');
    box.className = 'mp-draftbar';
    const text = document.createElement('div');
    text.innerHTML = `<b>✏️ You decorated a draft before signing in.</b><br><span class="mp-muted" style="font-size:12.5px;">“${escapeHtml(draft.title)}” is saved on this device — bring it in?</span>`;
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
        if (draft.template) rememberTemplate(page.id, draft.template);
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
    preview.style.cssText = 'font-size:13px;color:var(--accent-deep);font-weight:700;';
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

  // ------------------------------------------------------ Discover (gallery)

  let dirState = { subject: '', order: 'recent', q: '' };

  async function renderDirectory() {
    const app = document.getElementById('app');
    app.innerHTML = header() + `
      <main class="mp-home mp-has-nav" data-testid="directory">
        <section class="mp-hero" style="padding-bottom:0;">
          <h2 class="mp-hero-title" style="font-size:30px;">Discover</h2>
          <p class="mp-hero-sub">A gallery to wander, not a feed to scroll.</p>
        </section>
        <input id="mp-dir-search" class="mp-search" type="search" placeholder="Search by title or creator…" value="${escapeHtml(dirState.q)}">
        <div class="mp-dir-filters">
          <div class="mp-panel-row" id="mp-dir-subjects"></div>
          <div class="mp-panel-row">
            <button id="mp-dir-order" class="mp-chip mp-chip-btn"></button>
          </div>
        </div>
        <div id="mp-dir-grid" class="mp-dir-grid"><div class="mp-muted" style="padding:20px 4px;">wandering the gallery…</div></div>
        <p class="mp-muted" style="text-align:center;padding:20px 8px;font-size:12.5px;">a gallery to wander, not a feed to scroll</p>
      </main>` + bottomNav('discover');
    wireShell(app);
    loadCatalog().catch(() => {}); // sticker art for the mini previews

    const subjectsRow = app.querySelector('#mp-dir-subjects');
    const filters = [['', '✨ everything'], ['self', '🌟 corners'], ['friend', '💌 for friends'], ['pet', '🐾 pets'], ['oc', '🎭 OCs'], ['character', '📚 shrines']];
    filters.forEach(([value, label]) => {
      const b = document.createElement('button');
      b.className = 'mp-chip mp-chip-btn' + (dirState.subject === value ? ' mp-pill-on' : '');
      b.textContent = label;
      b.addEventListener('click', () => {
        dirState.subject = value;
        subjectsRow.querySelectorAll('.mp-chip').forEach((x) => x.classList.remove('mp-pill-on'));
        b.classList.add('mp-pill-on');
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

    let searchTimer = null;
    app.querySelector('#mp-dir-search').addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        dirState.q = e.target.value.trim();
        loadDirectory();
      }, 250);
    });

    loadDirectory();
  }

  async function loadDirectory() {
    const grid = document.getElementById('mp-dir-grid');
    if (!grid) return;
    try {
      const q = new URLSearchParams();
      if (dirState.subject) q.set('subject', dirState.subject);
      if (dirState.q) q.set('q', dirState.q);
      q.set('order', dirState.order);
      const [{ pages }] = await Promise.all([
        api('/api/public/directory?' + q.toString()),
        loadCatalog().catch(() => null),
      ]);
      grid.textContent = '';
      if (!pages.length) {
        const none = document.createElement('div');
        none.className = 'mp-muted';
        none.style.cssText = 'padding:26px 4px;text-align:center;';
        none.textContent = dirState.q ? 'nothing matches — try another word' : 'nothing here yet — be the first to decorate';
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

    // Mini live preview of the page's first section — the real thing,
    // scaled, through the shared renderer. Falls back to bg + text peek.
    const fs = p.first_section;
    if (fs && Array.isArray(fs.blocks) && fs.blocks.length) {
      a.appendChild(templatePreview({ version: 1, sections: [fs] }, { height: 110 }));
    } else {
      const preview = document.createElement('div');
      preview.className = 'mp-dir-preview';
      const css = window.PageRenderer.bgToCss(fs && fs.background);
      for (const k in css) preview.style[k] = css[k];
      const peek = document.createElement('span');
      peek.className = 'mp-dir-peek';
      peek.textContent = p.title;
      preview.appendChild(peek);
      a.appendChild(preview);
    }

    const info = document.createElement('div');
    info.className = 'mp-dir-info';
    const title = document.createElement('div');
    title.className = 'mp-dir-title';
    title.textContent = p.title;
    const sub = document.createElement('div');
    sub.className = 'mp-dir-sub';
    const bits = [`${meta.emoji} ${meta.chip}`];
    if (p.made_by_username) bits.push('by ' + p.made_by_username);
    sub.textContent = bits.join(' · ');
    const sub2 = document.createElement('div');
    sub2.className = 'mp-dir-sub';
    const bits2 = [];
    if (Number(p.visits) > 0) bits2.push(`${p.visits} visits`);
    if (p.updated_at) bits2.push('updated ' + timeAgo(p.updated_at));
    sub2.textContent = bits2.join(' · ');
    info.append(title, sub);
    if (bits2.length) info.appendChild(sub2);
    a.append(info);
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
        <div class="mp-make-top">${themeButton()}</div>
        <div class="mp-kicker" style="text-align:center;">no account needed to decorate</div>
        <h1 class="mp-wordmark" style="text-align:center;font-size:34px;">make your own</h1>
        <p class="mp-muted" style="text-align:center;max-width:340px;margin:6px auto 20px;">a small loud page — for yourself, a friend, your pet, your OC, or your comfort character. it saves on this device; an account only matters when you publish.</p>
        <div class="mp-doors" id="mp-make-doors"></div>
        <div id="mp-make-resume"></div>
        <p style="text-align:center;margin-top:26px;">
          <a href="/templates" data-nav="/templates" style="color:var(--accent-deep);font-weight:700;font-size:13.5px;">start from a template →</a><br>
          <a href="/directory" data-nav="/directory" style="color:var(--accent-deep);font-weight:700;font-size:13.5px;">or wander Discover →</a>
        </p>
      </main>`;
    app.querySelectorAll('[data-nav]').forEach((el) => {
      el.addEventListener('click', (e) => { e.preventDefault(); navigate(el.dataset.nav); });
    });
    wireThemeButton(app);

    if (draft) {
      const resume = document.createElement('button');
      resume.className = 'mp-btn mp-btn-accent';
      resume.style.cssText = 'display:block;margin:18px auto 0;';
      resume.textContent = `✏️ keep decorating “${draft.title}”`;
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

  // Editor guidance plumbing: which template a page started from lives in
  // localStorage (checklists are editor chrome, never page content).
  function rememberTemplate(pageId, templateKey) {
    try { localStorage.setItem('mp_tpl_' + pageId, templateKey); } catch {}
  }

  // opts.template — a catalog template row ({ key, name, content,
  // subject_type, … }); the page starts fully decorated from it.
  function openCreateForm(subjectType, local, opts = {}) {
    const meta = SUBJECTS[subjectType];
    const tpl = opts.template && opts.template.content ? opts.template : null;
    const content = document.createElement('div');
    content.className = 'mp-form';

    const nameField = meta.nameLabel ? `
      <label class="mp-label">${escapeHtml(meta.nameLabel)}</label>
      <input id="mp-f-name" class="mp-input" maxlength="120" placeholder="${subjectType === 'pet' ? 'Biscuit' : subjectType === 'friend' ? 'their name' : subjectType === 'oc' ? 'Vex' : 'Mr. Darcy'}">` : '';
    content.innerHTML = `
      ${tpl ? `<div class="mp-chip" style="background:var(--tint-accent);color:var(--accent-deep);margin-bottom:4px;">✨ starts from “${escapeHtml(tpl.name)}”</div>` : ''}
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
              const draft = {
                title, subject_type: subjectType, subject_name: name || null,
                content: tpl
                  ? JSON.parse(JSON.stringify(tpl.content))
                  : {
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
              };
              if (tpl) draft.template = tpl.key;
              MPDraft.save(draft);
              ctl.close();
              navigate('/make/edit');
              return;
            }
            btn.disabled = true; btn.textContent = 'Creating…';
            try {
              const body = { title, subject_type: subjectType, subject_name: name || null };
              if (tpl) body.template = tpl.key; // server copies the template doc
              const { page } = await api('/api/pages', { method: 'POST', body });
              if (tpl) rememberTemplate(page.id, tpl.key);
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

  window.MP = {
    api, navigate, escapeHtml, timeAgo, slugify, toast, openModal, SUBJECTS,
    renderMyPages, openAppearance, loadCatalog,
  };

  if (params.get('shot') === 'editor' && shotEditor()) {
    // shotEditor() already routed.
  } else {
    route();
  }
})();
