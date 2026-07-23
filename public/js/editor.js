// The MyPage editor: stacked sections, per-section backgrounds (incl.
// uploaded images), text/image/sticker/widget blocks with drag / rotate /
// resize / layering, the song, the cursor (presets + 32×32 pixel editor),
// vibe templates, guestbook moderation, gifts, footer styling — plus an
// account-less mode (/make) that saves a local draft until publish.
// Rendering goes through the shared PageRenderer so the editor preview and
// the public view can never drift apart.
(function () {
  'use strict';

  const R = () => window.PageRenderer;

  const PALETTE = [
    '#1F2B47', '#FFFFFF', '#FAF6EE', '#5A6378', '#D65A9E', '#FF6B57',
    '#C9A227', '#7FB542', '#2E9E8F', '#3F97E8', '#8A6FDF', '#2A1F3D',
  ];
  const BG_PRESETS = [
    { type: 'solid', color: '#FAF6EE' },
    { type: 'solid', color: '#2A1F3D' },
    { type: 'gradient', from: '#FDF3F9', to: '#EFE7FB', angle: 160 },
    { type: 'gradient', from: '#2A1F3D', to: '#4A2B62', angle: 160 },
    { type: 'gradient', from: '#FDF6EC', to: '#F7DFC8', angle: 145 },
    { type: 'gradient', from: '#0E2A3A', to: '#2E9E8F', angle: 200 },
    { type: 'gradient', from: '#FF6B57', to: '#8A6FDF', angle: 180 },
    { type: 'pattern', pattern: 'dots', color: '#FAF6EE', ink: '#E7DFCC' },
    { type: 'pattern', pattern: 'stripes', color: '#FFF4F9', ink: '#F4C7DE', angle: 45 },
    { type: 'pattern', pattern: 'stripes', color: '#FFE93F', ink: '#1F2B47', angle: 45 },
    { type: 'pattern', pattern: 'checker', color: '#FFFDF4', ink: '#F0E6C8' },
    { type: 'pattern', pattern: 'grid', color: '#101418', ink: '#233041' },
  ];
  const FONT_CHIPS = [
    { key: 'inter', label: 'Aa clean' },
    { key: 'fraunces', label: 'Aa serif' },
    { key: 'comic', label: 'Aa comic' },
    { key: 'hand', label: 'Aa hand' },
    { key: 'typewriter', label: 'Aa type' },
    { key: 'pixel', label: 'Aa pixel' },
  ];
  const STYLE_CHIPS = [
    { key: 'none', label: 'plain' },
    { key: 'sparkle', label: '✨ sparkle' },
    { key: 'rainbow', label: '🌈 rainbow' },
    { key: 'shadow', label: '🕶 shadow' },
    { key: 'outline', label: '◯ outline' },
  ];
  const WIDGET_KINDS = [
    { kind: 'song', label: '🎵 now playing', mk: () => ({ kind: 'song' }) },
    { kind: 'counter', label: '🔢 visit counter', mk: () => ({ kind: 'counter', style: 'classic' }) },
    { kind: 'guestbook', label: '📖 guestbook', mk: () => ({ kind: 'guestbook' }) },
    { kind: 'mood', label: '😌 mood', mk: () => ({ kind: 'mood', mood: '😌', label: 'cozy' }) },
    { kind: 'currently', label: '📚 currently…', mk: () => ({ kind: 'currently', items: [{ verb: 'reading', what: '…' }] }) },
    { kind: 'links', label: '🔗 link buttons', mk: () => ({ kind: 'links', links: [{ label: 'my link', url: 'https://' }] }) },
    { kind: 'marquee', label: '〰 marquee', mk: () => ({ kind: 'marquee', text: 'welcome to my corner ·', speed: 12, color: '#D65A9E', size: 18 }) },
  ];
  const FOOTER_STYLES = [
    { bg: '#1F2B47', color: '#FAF6EE' },
    { bg: '#FFD9F2', color: '#B03A7C' },
    { bg: '#2A1F3D', color: '#B3A6E8' },
    { bg: '#0A0F0A', color: '#57D93E' },
    { bg: '#FFE93F', color: '#1F2B47' },
    { bg: '#F3EDDF', color: '#5A6378' },
  ];

  let page = null;          // server row (or local-draft pseudo page)
  let isLocal = false;      // account-less /make mode
  let doc = null;
  let catalog = null;
  let canvas = null;
  let sel = null;           // { si, bi }
  let saveTimer = null;
  let saving = false;
  let dirty = false;
  let gesture = null;

  const uid = (p) => p + '-' + Math.random().toString(36).slice(2, 8);
  const deep = (o) => JSON.parse(JSON.stringify(o));

  function normalizeDoc(content) {
    const d = (content && typeof content === 'object' && Array.isArray(content.sections) && content.sections.length)
      ? content
      : { version: 1, cursor: null, song: null, footerStyle: null, sections: [] };
    if (!d.sections.length) {
      d.sections.push({ id: uid('s'), minHeight: 480, background: { type: 'solid', color: '#FAF6EE' }, blocks: [] });
    }
    d.sections.forEach((s) => { if (!Array.isArray(s.blocks)) s.blocks = []; });
    return d;
  }

  async function ensureCatalog() {
    if (catalog) return catalog;
    catalog = await MP.api('/api/public/catalog');
    R().setCatalog(catalog);
    MPCursor.setCatalog(catalog);
    MPSong.setCatalog(catalog);
    return catalog;
  }

  // ------------------------------------------------------------------ open

  // open(id) for a server page; open('local') for the account-less draft.
  async function open(id) {
    const app = document.getElementById('app');
    isLocal = id === 'local';
    app.innerHTML = `
      <header class="mp-topbar">
        <button id="mp-back" class="mp-iconbtn" aria-label="Back">←</button>
        <button id="mp-title" class="mp-topbar-title"></button>
        <span id="mp-savestate" class="mp-savestate"></span>
        <button id="mp-menu" class="mp-iconbtn" aria-label="Page menu">⋯</button>
        <button id="mp-publish" class="mp-btn mp-btn-accent mp-btn-sm">Publish</button>
      </header>
      <div id="mp-toolstrip" class="mp-toolstrip">
        <button class="mp-chip mp-chip-btn" data-tool="vibes">✨ vibes</button>
        <button class="mp-chip mp-chip-btn" data-tool="song">🎵 song</button>
        <button class="mp-chip mp-chip-btn" data-tool="cursor">🖱 cursor</button>
        <button class="mp-chip mp-chip-btn" data-tool="footer">🏷 footer</button>
        <button class="mp-chip mp-chip-btn" data-tool="guestbook" id="mp-tool-gb">📖 book</button>
      </div>
      <div id="mp-banner"></div>
      <div id="mp-canvas-wrap">
        <div id="mp-canvas" class="mp-editing" data-testid="editor-canvas"></div>
        <button id="mp-add-section" class="mp-add-section">＋ add a section</button>
        <div style="height:170px"></div>
      </div>
      <div id="mp-panel" class="mp-panel"></div>
    `;
    canvas = document.getElementById('mp-canvas');
    sel = null; dirty = false; saving = false; gesture = null;
    clearTimeout(saveTimer);

    document.getElementById('mp-back').addEventListener('click', async () => {
      if (dirty) await save();
      MP.navigate(isLocal ? '/make' : '/');
    });
    document.getElementById('mp-title').addEventListener('click', openRename);
    document.getElementById('mp-publish').addEventListener('click', openPublish);
    document.getElementById('mp-menu').addEventListener('click', openMenu);
    document.getElementById('mp-add-section').addEventListener('click', addSection);
    document.getElementById('mp-toolstrip').addEventListener('click', (e) => {
      const tool = e.target.closest('[data-tool]');
      if (!tool) return;
      const t = tool.dataset.tool;
      if (t === 'vibes') openVibes();
      else if (t === 'song') openSong();
      else if (t === 'cursor') openCursor();
      else if (t === 'footer') openFooterStyle();
      else if (t === 'guestbook') openGuestbookManager();
    });

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('dblclick', (e) => {
      const blockEl = e.target.closest('.mp-block');
      if (blockEl) { selectBlock(+blockEl.dataset.si, +blockEl.dataset.bi); openBlockEditor(); }
    });

    try {
      await ensureCatalog();
      if (isLocal) {
        const draft = MPDraft.load();
        if (!draft) { MP.navigate('/make', true); return; }
        page = {
          id: 'local', title: draft.title, subject_type: draft.subject_type,
          subject_name: draft.subject_name, content: draft.content,
          published: false, slug: null,
        };
        document.getElementById('mp-tool-gb').style.display = 'none';
      } else {
        ({ page } = await MP.api('/api/pages/' + id));
      }
    } catch (err) {
      canvas.innerHTML = '';
      const msg = document.createElement('div');
      msg.className = 'mp-muted';
      msg.style.padding = '32px 20px';
      msg.textContent = 'Couldn’t open this page — ' + err.message;
      canvas.appendChild(msg);
      return;
    }
    doc = normalizeDoc(page.content);
    refreshTopbar();
    renderBanner();
    renderCanvas();
    renderPanel();
  }

  function refreshTopbar() {
    document.getElementById('mp-title').textContent = page.title;
    const pub = document.getElementById('mp-publish');
    pub.textContent = page.published ? 'Published ✓' : 'Publish';
  }

  function renderBanner() {
    const el = document.getElementById('mp-banner');
    if (!el) return;
    el.textContent = '';
    if (page.directory_delisted_by_report) {
      const b = document.createElement('div');
      b.className = 'mp-warnbar';
      b.textContent = '⚠ Someone reported this page as being about them, so it’s hidden from the directory while that’s sorted out. The link still works.';
      el.appendChild(b);
    }
    if (isLocal) {
      const b = document.createElement('div');
      b.className = 'mp-infobar';
      b.textContent = '✎ Draft saved on this device only — publish to give it a home.';
      el.appendChild(b);
    }
  }

  function setSaveState(text) {
    const el = document.getElementById('mp-savestate');
    if (el) el.textContent = text;
  }

  // ---------------------------------------------------------------- saving

  function markDirty() {
    dirty = true;
    setSaveState('…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 900);
  }

  async function save() {
    clearTimeout(saveTimer);
    if (isLocal) {
      MPDraft.save({ title: page.title, subject_type: page.subject_type, subject_name: page.subject_name, content: doc });
      dirty = false;
      setSaveState('saved here ✓');
      return;
    }
    if (saving) { markDirty(); return; }
    saving = true;
    setSaveState('saving…');
    try {
      await MP.api('/api/pages/' + page.id, {
        method: 'PUT',
        body: { title: page.title, content: doc, footer_style: doc.footerStyle || null },
      });
      dirty = false;
      setSaveState('saved ✓');
    } catch (err) {
      setSaveState('couldn’t save — retrying');
      clearTimeout(saveTimer);
      saveTimer = setTimeout(save, 3000);
    } finally {
      saving = false;
    }
  }

  // ------------------------------------------------------------- rendering

  function renderCanvas() {
    R().render(doc, canvas, { editing: true, visits: 47, footer: true, footerStyle: doc.footerStyle });
    canvas.querySelectorAll('.mp-section').forEach((secEl) => {
      const si = +secEl.dataset.si;
      const bar = document.createElement('div');
      bar.className = 'mp-section-bar';
      const bgBtn = document.createElement('button');
      bgBtn.className = 'mp-chip mp-chip-btn';
      bgBtn.textContent = '🎨';
      bgBtn.title = 'section background';
      bgBtn.addEventListener('click', () => openSectionModal(si));
      const addBtn = document.createElement('button');
      addBtn.className = 'mp-chip mp-chip-btn';
      addBtn.textContent = '＋ add';
      addBtn.addEventListener('click', () => openInsertMenu(si));
      bar.append(bgBtn, addBtn);
      secEl.appendChild(bar);
    });
    restoreSelection();
  }

  function blockEl(si, bi) {
    return canvas.querySelector(`.mp-block[data-si="${si}"][data-bi="${bi}"]`);
  }
  function sectionEl(si) {
    return canvas.querySelector(`.mp-section[data-si="${si}"]`);
  }
  function selBlock() {
    return sel ? (doc.sections[sel.si] || { blocks: [] }).blocks[sel.bi] : null;
  }

  function restoreSelection() {
    if (!sel) return;
    const el = blockEl(sel.si, sel.bi);
    if (!el) { sel = null; renderPanel(); return; }
    decorateSelected(el);
  }

  function decorateSelected(el) {
    el.classList.add('mp-selected');
    const rot = document.createElement('div');
    rot.className = 'mp-handle mp-handle-rotate';
    rot.textContent = '⟳';
    const rez = document.createElement('div');
    rez.className = 'mp-handle mp-handle-resize';
    rez.textContent = '↔';
    el.append(rot, rez);
  }

  function clearSelection() {
    canvas.querySelectorAll('.mp-block.mp-selected').forEach((el) => {
      el.classList.remove('mp-selected');
      el.querySelectorAll('.mp-handle').forEach((h) => h.remove());
    });
  }

  function selectBlock(si, bi) {
    sel = { si, bi };
    clearSelection();
    const el = blockEl(si, bi);
    if (el) decorateSelected(el);
    renderPanel();
  }

  function deselect() {
    sel = null;
    clearSelection();
    renderPanel();
  }

  // -------------------------------------------------------------- gestures

  function onPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    const handle = e.target.closest('.mp-handle');
    const blockDom = e.target.closest('.mp-block');
    if (e.target.closest('.mp-section-bar')) return;

    if (handle && sel) {
      const el = blockEl(sel.si, sel.bi);
      const block = selBlock();
      if (!el || !block) return;
      const rect = el.getBoundingClientRect();
      const secRect = sectionEl(sel.si).getBoundingClientRect();
      if (handle.classList.contains('mp-handle-rotate')) {
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        gesture = {
          type: 'rotate', el, block, cx, cy,
          startAngle: Math.atan2(e.clientY - cy, e.clientX - cx),
          origRot: Number(block.rotation) || 0,
        };
      } else {
        gesture = {
          type: 'resize', el, block, secRect,
          startX: e.clientX,
          origW: Number(block.w) || 60,
        };
      }
    } else if (blockDom) {
      const si = +blockDom.dataset.si;
      const bi = +blockDom.dataset.bi;
      if (!sel || sel.si !== si || sel.bi !== bi) selectBlock(si, bi);
      const block = selBlock();
      const el = blockEl(si, bi);
      const secRect = sectionEl(si).getBoundingClientRect();
      gesture = {
        type: 'drag', el, block, secRect,
        startX: e.clientX, startY: e.clientY,
        origX: Number(block.x) || 0, origY: Number(block.y) || 0,
        moved: false,
      };
    } else {
      deselect();
      return;
    }
    if (window.unNative && unNative.gestures) {
      unNative.gestures.claim(e.pointerType === 'touch' ? 'touch' : e.pointerId, 'mp-editor');
    }
    try { canvas.setPointerCapture(e.pointerId); } catch {}
    e.preventDefault();
  }

  function onPointerMove(e) {
    if (!gesture) return;
    const g = gesture;
    const clamp = R().clamp;
    if (g.type === 'drag') {
      const dx = e.clientX - g.startX;
      const dy = e.clientY - g.startY;
      if (Math.abs(dx) + Math.abs(dy) > 3) g.moved = true;
      g.block.x = clamp(g.origX + (dx / g.secRect.width) * 100, -20, 110, g.origX);
      g.block.y = clamp(g.origY + dy, 0, 8000, g.origY);
      R().applyBlockGeometry(g.el, g.block);
    } else if (g.type === 'rotate') {
      const a = Math.atan2(e.clientY - g.cy, e.clientX - g.cx);
      let rot = g.origRot + (a - g.startAngle) * 180 / Math.PI;
      rot = ((rot + 180) % 360 + 360) % 360 - 180;
      if (Math.abs(rot) < 3) rot = 0; // gentle snap to straight
      g.block.rotation = Math.round(rot);
      R().applyBlockGeometry(g.el, g.block);
    } else if (g.type === 'resize') {
      const dW = ((e.clientX - g.startX) / g.secRect.width) * 100;
      g.block.w = Math.round(clamp(g.origW + dW, 4, 120, g.origW));
      R().applyBlockGeometry(g.el, g.block);
    }
  }

  function onPointerUp(e) {
    if (!gesture) return;
    const g = gesture;
    gesture = null;
    try { canvas.releasePointerCapture(e.pointerId); } catch {}
    if (g.type !== 'drag' || g.moved) {
      markDirty();
      if (sel) R().fitSection(sectionEl(sel.si));
    }
  }

  // ------------------------------------------------------------- mutations

  function insertBlock(si, block, thenEdit) {
    const section = doc.sections[si];
    const maxZ = section.blocks.reduce((m, b) => Math.max(m, Number(b.z) || 1), 0);
    block.z = maxZ + 1;
    section.blocks.push(block);
    markDirty();
    renderCanvas();
    selectBlock(si, section.blocks.length - 1);
    if (thenEdit) openBlockEditor();
  }

  function addSection() {
    const preset = BG_PRESETS[(doc.sections.length + 2) % BG_PRESETS.length];
    doc.sections.push({ id: uid('s'), minHeight: 420, background: deep(preset), blocks: [] });
    markDirty();
    deselect();
    renderCanvas();
    requestAnimationFrame(() => {
      const secs = canvas.querySelectorAll('.mp-section');
      const last = secs[secs.length - 1];
      if (last) last.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  function deleteSelected() {
    if (!sel) return;
    doc.sections[sel.si].blocks.splice(sel.bi, 1);
    sel = null;
    markDirty();
    renderCanvas();
    renderPanel();
  }

  function layerSelected(delta) {
    const block = selBlock();
    if (!block) return;
    block.z = R().clamp((Number(block.z) || 1) + delta, 1, 200, 1);
    const el = blockEl(sel.si, sel.bi);
    if (el) R().applyBlockGeometry(el, block);
    markDirty();
  }

  function rerenderSelected() {
    if (!sel) return;
    markDirty();
    renderCanvas();
    renderPanel();
  }

  function updateSelectedText(mutator, skipPanel) {
    const block = selBlock();
    if (!block || block.type !== 'text') return;
    mutator(block.props);
    const el = blockEl(sel.si, sel.bi);
    if (el) {
      R().applyTextProps(el.querySelector('.mp-text'), block.props);
      R().fitSection(sectionEl(sel.si));
    }
    markDirty();
    if (!skipPanel) renderPanel();
  }

  // ----------------------------------------------------------- insert menu

  function openInsertMenu(si) {
    const content = document.createElement('div');
    content.className = 'mp-doors';
    let ctl;
    const doors = [
      ['📝', 'text', () => insertBlock(si, { id: uid('b'), type: 'text', x: 8, y: 40, w: 66, rotation: 0, props: { text: 'write something…', font: 'inter', size: 22, color: '#1F2B47', bold: false, align: 'left', style: 'none' } }, true)],
      ['🖼', 'photo', () => pickImage(si)],
      ['🏷', 'sticker', () => openStickerPicker(si)],
      ['🧩', 'widget', () => openWidgetPicker(si)],
    ];
    doors.forEach(([emoji, label, fn]) => {
      const door = document.createElement('button');
      door.className = 'mp-door';
      door.innerHTML = `<span class="mp-door-emoji">${emoji}</span><span>${label}</span>`;
      door.addEventListener('click', () => { ctl.close(); fn(); });
      content.appendChild(door);
    });
    ctl = MP.openModal({ title: 'Add to this section', contentEl: content });
  }

  // ------------------------------------------------------------- stickers

  function openStickerPicker(si) {
    const content = document.createElement('div');
    let ctl;
    (catalog.stickerPacks || []).forEach((pack) => {
      const label = document.createElement('div');
      label.className = 'mp-label';
      label.textContent = pack.name;
      content.appendChild(label);
      const grid = document.createElement('div');
      grid.className = 'mp-sticker-grid';
      pack.stickers.forEach((st) => {
        const cell = document.createElement('button');
        cell.className = 'mp-sticker-cell';
        cell.innerHTML = st.svg; // catalog art, app-shipped — not user content
        cell.addEventListener('click', () => {
          ctl.close();
          const wide = st.key.startsWith('badge-');
          insertBlock(si, { id: uid('b'), type: 'sticker', x: 30, y: 60, w: wide ? 38 : 22, rotation: 0, props: { key: st.key } });
        });
        grid.appendChild(cell);
      });
      content.appendChild(grid);
    });
    ctl = MP.openModal({ title: 'Stickers', contentEl: content, actions: [{ label: 'Close' }] });
  }

  // --------------------------------------------------------------- images

  function pickImage(si, forBackground) {
    if (isLocal) { MP.toast('Photos need an account — publish first, then add them'); return; }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp,image/gif';
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      MP.toast('Uploading…');
      try {
        const asset = await uploadImage(file);
        if (forBackground) {
          doc.sections[si].background = { type: 'image', assetId: asset.id, tile: false, color: '#FAF6EE' };
          markDirty();
          renderCanvas();
        } else {
          insertBlock(si, { id: uid('b'), type: 'image', x: 12, y: 50, w: 55, rotation: 0, props: { assetId: asset.id, alt: '' } });
        }
        MP.toast('Added ✓');
      } catch (err) {
        MP.toast(err.message);
      }
    });
    input.click();
  }

  // Client-side resize to ≤1600px before upload (GIFs go raw to keep the
  // animation, capped by the server at 2MB).
  async function uploadImage(file) {
    let blob = file;
    let mime = file.type;
    if (file.type !== 'image/gif') {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * scale);
      c.height = Math.round(bmp.height * scale);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
      blob = await new Promise((res) => c.toBlob(res, mime, 0.85));
      if (!blob) throw new Error('Couldn’t read that image');
    }
    if (blob.size > 2 * 1024 * 1024) throw new Error('That image is too big (2MB max)');
    const b64 = await blobToBase64(blob);
    return MP.api('/api/uploads', { method: 'POST', body: { kind: 'image', mime, data: b64 } });
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1]);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }

  // -------------------------------------------------------------- widgets

  function openWidgetPicker(si) {
    const content = document.createElement('div');
    content.className = 'mp-doors';
    let ctl;
    WIDGET_KINDS.forEach((w) => {
      const door = document.createElement('button');
      door.className = 'mp-door';
      door.innerHTML = `<span class="mp-door-emoji">${w.label.split(' ')[0]}</span><span>${MP.escapeHtml(w.label.slice(w.label.indexOf(' ') + 1))}</span>`;
      door.addEventListener('click', () => {
        ctl.close();
        insertBlock(si, { id: uid('b'), type: 'widget', x: 8, y: 50, w: 80, rotation: 0, props: w.mk() }, w.kind !== 'counter' && w.kind !== 'guestbook');
        if (w.kind === 'song' && !doc.song) openSong();
      });
      content.appendChild(door);
    });
    ctl = MP.openModal({ title: 'Widgets', contentEl: content });
  }

  // Per-kind widget prop editors, opened from the panel's ✏️ edit.
  function openBlockEditor() {
    const block = selBlock();
    if (!block) return;
    if (block.type === 'text') return openTextModal();
    if (block.type === 'image') return openImageProps();
    if (block.type === 'widget') {
      const kind = block.props.kind;
      if (kind === 'mood') return openMoodProps(block);
      if (kind === 'currently') return openCurrentlyProps(block);
      if (kind === 'links') return openLinksProps(block);
      if (kind === 'marquee') return openMarqueeProps(block);
      if (kind === 'counter') return openCounterProps(block);
      if (kind === 'song') return openSong();
      MP.toast('Drag it, rotate it, resize it — that’s the widget');
    }
  }

  function fieldRow(labelText, inputEl) {
    const wrap = document.createElement('div');
    const label = document.createElement('div');
    label.className = 'mp-label';
    label.textContent = labelText;
    wrap.append(label, inputEl);
    return wrap;
  }
  function textInput(value, maxLength, placeholder) {
    const i = document.createElement('input');
    i.className = 'mp-input';
    i.value = value || '';
    if (maxLength) i.maxLength = maxLength;
    if (placeholder) i.placeholder = placeholder;
    return i;
  }

  function openMoodProps(block) {
    const content = document.createElement('div');
    const mood = textInput(block.props.mood, 8, '😌');
    const label = textInput(block.props.label, 40, 'cozy');
    content.append(fieldRow('Mood (emoji)', mood), fieldRow('One word', label));
    MP.openModal({
      title: '😌 mood', contentEl: content,
      actions: [{ label: 'Cancel' }, {
        label: 'Save', accent: true,
        onClick(ctl) { block.props.mood = mood.value; block.props.label = label.value; ctl.close(); rerenderSelected(); },
      }],
    });
  }

  function openCurrentlyProps(block) {
    const content = document.createElement('div');
    const rows = [];
    const list = document.createElement('div');
    function addRow(item) {
      const wrap = document.createElement('div');
      wrap.className = 'mp-panel-row';
      const verb = textInput(item.verb, 24, 'reading');
      verb.style.flex = '0 0 110px';
      const what = textInput(item.what, 120, 'Piranesi');
      wrap.append(verb, what);
      list.appendChild(wrap);
      rows.push({ verb, what });
    }
    (Array.isArray(block.props.items) && block.props.items.length ? block.props.items : [{ verb: 'reading', what: '' }]).slice(0, 6).forEach(addRow);
    content.appendChild(list);
    const more = document.createElement('button');
    more.className = 'mp-chip mp-chip-btn';
    more.textContent = '＋ row';
    more.addEventListener('click', () => { if (rows.length < 6) addRow({ verb: '', what: '' }); });
    content.appendChild(more);
    MP.openModal({
      title: '📚 currently…', contentEl: content,
      actions: [{ label: 'Cancel' }, {
        label: 'Save', accent: true,
        onClick(ctl) {
          block.props.items = rows.map((r) => ({ verb: r.verb.value.trim(), what: r.what.value.trim() })).filter((r) => r.verb || r.what);
          ctl.close(); rerenderSelected();
        },
      }],
    });
  }

  function openLinksProps(block) {
    const content = document.createElement('div');
    const rows = [];
    const list = document.createElement('div');
    function addRow(item) {
      const wrap = document.createElement('div');
      wrap.className = 'mp-panel-row';
      const label = textInput(item.label, 60, 'label');
      label.style.flex = '0 0 110px';
      const url = textInput(item.url, 500, 'https://…');
      wrap.append(label, url);
      list.appendChild(wrap);
      rows.push({ label, url });
    }
    (Array.isArray(block.props.links) && block.props.links.length ? block.props.links : [{ label: '', url: '' }]).slice(0, 8).forEach(addRow);
    content.appendChild(list);
    const more = document.createElement('button');
    more.className = 'mp-chip mp-chip-btn';
    more.textContent = '＋ link';
    more.addEventListener('click', () => { if (rows.length < 8) addRow({ label: '', url: '' }); });
    content.appendChild(more);
    MP.openModal({
      title: '🔗 link buttons', contentEl: content,
      actions: [{ label: 'Cancel' }, {
        label: 'Save', accent: true,
        onClick(ctl) {
          block.props.links = rows.map((r) => ({ label: r.label.value.trim(), url: r.url.value.trim() })).filter((r) => r.label || r.url);
          ctl.close(); rerenderSelected();
        },
      }],
    });
  }

  function openMarqueeProps(block) {
    const content = document.createElement('div');
    const text = textInput(block.props.text, 300, 'welcome to my corner ·');
    const speed = document.createElement('input');
    speed.type = 'range'; speed.min = '3'; speed.max = '40';
    speed.value = String(R().clamp(block.props.speed, 3, 40, 12));
    speed.className = 'mp-slider'; speed.style.width = '100%';
    const size = document.createElement('input');
    size.type = 'range'; size.min = '10'; size.max = '60';
    size.value = String(R().clamp(block.props.size, 10, 60, 18));
    size.className = 'mp-slider'; size.style.width = '100%';
    const colorRow = document.createElement('div');
    colorRow.className = 'mp-panel-row';
    let chosen = block.props.color || '#D65A9E';
    PALETTE.forEach((c) => {
      const sw = document.createElement('button');
      sw.className = 'mp-swatch' + (chosen === c ? ' mp-swatch-on' : '');
      sw.style.background = c;
      sw.addEventListener('click', () => {
        chosen = c;
        colorRow.querySelectorAll('.mp-swatch').forEach((x) => x.classList.remove('mp-swatch-on'));
        sw.classList.add('mp-swatch-on');
      });
      colorRow.appendChild(sw);
    });
    content.append(fieldRow('Text', text), fieldRow('Slow → fast', speed), fieldRow('Size', size), fieldRow('Color', colorRow));
    MP.openModal({
      title: '〰 marquee', contentEl: content,
      actions: [{ label: 'Cancel' }, {
        label: 'Save', accent: true,
        onClick(ctl) {
          block.props.text = text.value;
          block.props.speed = 43 - Number(speed.value); // slider left = slow
          block.props.size = Number(size.value);
          block.props.color = chosen;
          ctl.close(); rerenderSelected();
        },
      }],
    });
  }

  function openCounterProps(block) {
    const content = document.createElement('div');
    content.className = 'mp-panel-row';
    ['classic', 'pink', 'terminal'].forEach((styleKey) => {
      const b = document.createElement('button');
      b.className = 'mp-chip mp-chip-btn' + (block.props.style === styleKey ? ' mp-chip-on' : '');
      b.textContent = styleKey;
      b.addEventListener('click', () => {
        block.props.style = styleKey;
        content.querySelectorAll('.mp-chip').forEach((x) => x.classList.remove('mp-chip-on'));
        b.classList.add('mp-chip-on');
        rerenderSelected();
      });
      content.appendChild(b);
    });
    const note = document.createElement('p');
    note.className = 'mp-muted';
    note.style.fontSize = '12.5px';
    note.textContent = 'The counter shows real visits on your published page. Don’t want one? Just delete the widget.';
    const wrap = document.createElement('div');
    wrap.append(content, note);
    MP.openModal({ title: '🔢 visit counter', contentEl: wrap, actions: [{ label: 'Done' }] });
  }

  function openImageProps() {
    const block = selBlock();
    const content = document.createElement('div');
    const alt = textInput(block.props.alt, 200, 'describe the photo (for screen readers)');
    content.appendChild(fieldRow('Alt text', alt));
    MP.openModal({
      title: '🖼 photo', contentEl: content,
      actions: [{ label: 'Cancel' }, {
        label: 'Save', accent: true,
        onClick(ctl) { block.props.alt = alt.value; ctl.close(); rerenderSelected(); },
      }],
    });
  }

  // ----------------------------------------------------------- bottom panel

  function chipRow(items, isActive, onPick) {
    const row = document.createElement('div');
    row.className = 'mp-panel-row';
    items.forEach((it) => {
      const b = document.createElement('button');
      b.className = 'mp-chip mp-chip-btn' + (isActive(it) ? ' mp-chip-on' : '');
      b.textContent = it.label;
      b.addEventListener('click', () => onPick(it));
      row.appendChild(b);
    });
    return row;
  }

  function commonRow() {
    const row = document.createElement('div');
    row.className = 'mp-panel-row';
    const edit = document.createElement('button');
    edit.className = 'mp-chip mp-chip-btn mp-chip-strong';
    edit.textContent = '✏️ edit';
    edit.addEventListener('click', openBlockEditor);
    const up = document.createElement('button');
    up.className = 'mp-chip mp-chip-btn'; up.textContent = '⬆ layer';
    up.addEventListener('click', () => layerSelected(1));
    const down = document.createElement('button');
    down.className = 'mp-chip mp-chip-btn'; down.textContent = '⬇ layer';
    down.addEventListener('click', () => layerSelected(-1));
    const del = document.createElement('button');
    del.className = 'mp-chip mp-chip-btn mp-chip-danger'; del.textContent = '🗑';
    del.addEventListener('click', deleteSelected);
    const done = document.createElement('button');
    done.className = 'mp-chip mp-chip-btn'; done.textContent = 'done';
    done.addEventListener('click', deselect);
    row.append(edit, up, down, del, done);
    return row;
  }

  function renderPanel() {
    const panel = document.getElementById('mp-panel');
    if (!panel) return;
    panel.textContent = '';
    const block = selBlock();

    if (!block) {
      const hint = document.createElement('div');
      hint.className = 'mp-panel-row mp-panel-hint';
      hint.innerHTML = '<span class="mp-muted">tap a block to style it · drag to move · ＋ add on a section</span>';
      panel.appendChild(hint);
      return;
    }

    if (block.type !== 'text') {
      panel.appendChild(commonRow());
      return;
    }

    const p = block.props;
    panel.appendChild(commonRow());
    panel.appendChild(chipRow(FONT_CHIPS, (f) => p.font === f.key, (f) => updateSelectedText((pp) => { pp.font = f.key; })));

    const row2 = document.createElement('div');
    row2.className = 'mp-panel-row';
    const size = document.createElement('input');
    size.type = 'range'; size.min = '10'; size.max = '96'; size.value = String(Number(p.size) || 20);
    size.className = 'mp-slider';
    size.addEventListener('input', () => updateSelectedText((pp) => { pp.size = +size.value; }, true));
    const bold = document.createElement('button');
    bold.className = 'mp-chip mp-chip-btn' + (p.bold ? ' mp-chip-on' : '');
    bold.innerHTML = '<b>B</b>';
    bold.addEventListener('click', () => updateSelectedText((pp) => { pp.bold = !pp.bold; }));
    const align = document.createElement('button');
    align.className = 'mp-chip mp-chip-btn';
    align.textContent = p.align === 'center' ? '⇔ center' : p.align === 'right' ? '→ right' : '← left';
    align.addEventListener('click', () => updateSelectedText((pp) => {
      pp.align = pp.align === 'left' ? 'center' : pp.align === 'center' ? 'right' : 'left';
    }));
    row2.append(size, bold, align);
    panel.appendChild(row2);

    panel.appendChild(chipRow(STYLE_CHIPS, (s) => (p.style || 'none') === s.key, (s) => updateSelectedText((pp) => { pp.style = s.key; })));

    const row3 = document.createElement('div');
    row3.className = 'mp-panel-row';
    PALETTE.forEach((c) => {
      const sw = document.createElement('button');
      sw.className = 'mp-swatch' + (p.color === c ? ' mp-swatch-on' : '');
      sw.style.background = c;
      sw.setAttribute('aria-label', 'color ' + c);
      sw.addEventListener('click', () => updateSelectedText((pp) => { pp.color = c; }));
      row3.appendChild(sw);
    });
    const custom = document.createElement('input');
    custom.type = 'color';
    custom.value = /^#[0-9a-fA-F]{6}$/.test(p.color) ? p.color : '#1F2B47';
    custom.className = 'mp-swatch mp-swatch-custom';
    custom.addEventListener('input', () => updateSelectedText((pp) => { pp.color = custom.value; }, true));
    row3.appendChild(custom);
    panel.appendChild(row3);
  }

  // ---------------------------------------------------------------- modals

  function openTextModal() {
    const block = selBlock();
    if (!block || block.type !== 'text') return;
    const content = document.createElement('div');
    const ta = document.createElement('textarea');
    ta.className = 'mp-input mp-textarea';
    ta.maxLength = 4000;
    ta.value = block.props.text || '';
    content.appendChild(ta);
    MP.openModal({
      title: 'Text',
      contentEl: content,
      actions: [
        { label: 'Cancel' },
        {
          label: 'Save', accent: true,
          onClick(ctl) {
            updateSelectedText((pp) => { pp.text = ta.value; });
            ctl.close();
          },
        },
      ],
    });
    setTimeout(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 60);
  }

  function openRename() {
    const content = document.createElement('div');
    const input = textInput(page.title, 120);
    content.appendChild(input);
    MP.openModal({
      title: 'Page title',
      contentEl: content,
      actions: [
        { label: 'Cancel' },
        {
          label: 'Save', accent: true,
          onClick(ctl) {
            const t = input.value.trim();
            if (!t) { input.focus(); return; }
            page.title = t;
            refreshTopbar();
            markDirty();
            ctl.close();
          },
        },
      ],
    });
    setTimeout(() => input.focus(), 60);
  }

  // -------------------------------------------------------------- ⋯ menu

  function openMenu() {
    const content = document.createElement('div');
    let ctl;
    const mkRow = (label, fn) => {
      const b = document.createElement('button');
      b.className = 'mp-menurow';
      b.textContent = label;
      b.addEventListener('click', () => { ctl.close(); fn(); });
      content.appendChild(b);
    };
    if (!isLocal) {
      if (page.published) {
        mkRow('↗ open the public page', () => window.open('/p/' + page.slug, '_blank'));
      }
      mkRow('🎁 send as a gift', openGift);
      mkRow(page.directory_listed !== false ? '🙈 hide from the directory' : '👀 list in the directory', async () => {
        try {
          const res = await MP.api('/api/pages/' + page.id, { method: 'PUT', body: { directory_listed: !(page.directory_listed !== false) } });
          page = Object.assign(page, res.page);
          MP.toast(page.directory_listed ? 'Listed in the directory' : 'Hidden from the directory');
        } catch (err) { MP.toast(err.message); }
      });
      mkRow('🗑 delete this page', openDelete);
    } else {
      mkRow('🗑 discard this draft', () => {
        MPDraft.clear();
        MP.toast('Draft discarded');
        MP.navigate('/make', true);
      });
    }
    ctl = MP.openModal({ title: page.title, contentEl: content, actions: [{ label: 'Close' }] });
  }

  function openDelete() {
    const content = document.createElement('div');
    content.innerHTML = `<p class="mp-muted" style="font-size:13px;">Deleting removes the page and its guestbook for good.</p>`;
    MP.openModal({
      title: 'Delete ' + page.title + '?',
      contentEl: content,
      actions: [
        { label: 'Keep it' },
        {
          label: 'Delete forever',
          async onClick(ctl, btn) {
            btn.disabled = true;
            try {
              await MP.api('/api/pages/' + page.id, { method: 'DELETE' });
              ctl.close();
              MP.toast('Page deleted');
              MP.navigate('/');
            } catch (err) {
              btn.disabled = false;
              MP.toast(err.message);
            }
          },
        },
      ],
    });
  }

  // ---------------------------------------------------------------- gifts

  function openGift() {
    const content = document.createElement('div');
    content.innerHTML = `<p class="mp-muted" style="font-size:13.5px;">Send this page to its person. They open the link, see the whole page, and can claim it — co-owning it with you or taking it over.</p>`;
    const hint = textInput('', 120, 'their Usernode username (optional)');
    content.appendChild(fieldRow('Who is it for?', hint));
    const out = document.createElement('div');
    content.appendChild(out);
    MP.openModal({
      title: '🎁 send as a gift',
      contentEl: content,
      actions: [
        { label: 'Close' },
        {
          label: 'Create gift link', accent: true,
          async onClick(_ctl, btn) {
            btn.disabled = true;
            try {
              const res = await MP.api('/api/pages/' + page.id + '/gift', { method: 'POST', body: { recipient_hint: hint.value.trim() || null } });
              const url = location.origin + res.url;
              out.innerHTML = '';
              const box = document.createElement('div');
              box.className = 'mp-linkbox';
              box.textContent = url;
              const copy = document.createElement('button');
              copy.className = 'mp-btn mp-btn-accent mp-btn-sm';
              copy.style.marginTop = '10px';
              copy.textContent = 'Copy gift link';
              copy.addEventListener('click', () => {
                navigator.clipboard && navigator.clipboard.writeText(url).then(() => { copy.textContent = 'Copied ✓'; });
              });
              const note = document.createElement('p');
              note.className = 'mp-muted';
              note.style.fontSize = '12px';
              note.textContent = 'Anyone with this link can claim the page — send it to the right person 💌';
              out.append(box, copy, note);
              btn.remove();
            } catch (err) {
              btn.disabled = false;
              MP.toast(err.message);
            }
          },
        },
      ],
    });
  }

  // ----------------------------------------------------------------- song

  function openSong() {
    const song = doc.song || { title: '', artist: '', linkUrl: '', source: 'none' };
    const content = document.createElement('div');
    const title = textInput(song.title, 90, 'Pictures of You');
    const artist = textInput(song.artist, 90, 'The Cure');
    const link = textInput(song.linkUrl || '', 500, 'https://open.spotify.com/…');
    content.append(
      fieldRow('Song', title),
      fieldRow('Artist', artist),
      fieldRow('Listen link (Spotify / Apple / YouTube…)', link)
    );

    const srcLabel = document.createElement('div');
    srcLabel.className = 'mp-label';
    srcLabel.textContent = 'Playable audio (safe sources only)';
    content.appendChild(srcLabel);
    const note = document.createElement('p');
    note.className = 'mp-muted';
    note.style.fontSize = '12px';
    note.textContent = 'Pages can play our free library or your own original audio — the named song above links out instead (no unlicensed playback).';
    content.appendChild(note);

    let source = song.source || 'none';
    const srcList = document.createElement('div');
    srcList.className = 'mp-src-list';
    function refreshSrc() {
      srcList.querySelectorAll('.mp-src-row').forEach((r) => {
        r.classList.toggle('mp-src-on', r.dataset.src === source);
      });
    }
    function srcRow(value, labelText, extraEl) {
      const row = document.createElement('div');
      row.className = 'mp-src-row';
      row.dataset.src = value;
      const btn = document.createElement('button');
      btn.className = 'mp-src-pick';
      btn.textContent = labelText;
      btn.addEventListener('click', () => { source = value; refreshSrc(); });
      row.appendChild(btn);
      if (extraEl) row.appendChild(extraEl);
      srcList.appendChild(row);
      return row;
    }
    srcRow('none', '🔇 no playback (just the name + link)');
    (catalog.music || []).forEach((m) => {
      const preview = document.createElement('button');
      preview.className = 'mp-chip mp-chip-btn';
      preview.textContent = '▶';
      preview.addEventListener('click', () => MPSong.toggle(m.file_path, preview, null));
      srcRow('library:' + m.key, `🎶 ${m.title} · ${m.style}`, preview);
    });
    const uploadBtn = document.createElement('button');
    uploadBtn.className = 'mp-chip mp-chip-btn';
    uploadBtn.textContent = 'choose file';
    uploadBtn.addEventListener('click', () => pickAudio((assetId) => {
      source = 'upload:' + assetId;
      uploadBtn.textContent = 'uploaded ✓';
      refreshSrc();
    }));
    const upRow = srcRow(source.startsWith('upload:') ? source : 'upload:pending', '🎤 my own original audio', uploadBtn);
    if (source.startsWith('upload:')) upRow.dataset.src = source;
    content.appendChild(srcList);
    refreshSrc();

    MP.openModal({
      title: '🎵 now playing — on repeat',
      contentEl: content,
      actions: [
        { label: 'Cancel', onClick(ctl) { MPSong.stop(); ctl.close(); } },
        {
          label: 'Remove song',
          onClick(ctl) { doc.song = null; MPSong.stop(); markDirty(); renderCanvas(); ctl.close(); },
        },
        {
          label: 'Save', accent: true,
          onClick(ctl) {
            MPSong.stop();
            doc.song = {
              title: title.value.trim(),
              artist: artist.value.trim(),
              linkUrl: link.value.trim() || null,
              source: source === 'upload:pending' ? 'none' : source,
            };
            markDirty();
            renderCanvas();
            ctl.close();
          },
        },
      ],
    });
  }

  function pickAudio(onDone) {
    if (isLocal) { MP.toast('Audio uploads need an account — publish first'); return; }
    const content = document.createElement('div');
    content.innerHTML = `<p class="mp-muted" style="font-size:13px;">Only audio that is <b>yours</b> — your band, your voice note, your beep-boops. No ripped tracks; that’s the one MySpace feature we don’t resurrect.</p>`;
    const check = document.createElement('label');
    check.style.cssText = 'display:flex;gap:8px;align-items:flex-start;font-size:13.5px;padding:8px 0;cursor:pointer;';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    const span = document.createElement('span');
    span.textContent = 'This is my own original audio and I have the right to share it.';
    check.append(cb, span);
    content.appendChild(check);
    MP.openModal({
      title: '🎤 upload original audio',
      contentEl: content,
      actions: [
        { label: 'Cancel' },
        {
          label: 'Choose file', accent: true,
          onClick(ctl) {
            if (!cb.checked) { MP.toast('Tick the box first — it matters'); return; }
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'audio/mpeg,audio/mp3,audio/ogg,audio/wav,audio/mp4,audio/x-m4a';
            input.addEventListener('change', async () => {
              const file = input.files && input.files[0];
              if (!file) return;
              if (file.size > 5 * 1024 * 1024) { MP.toast('Too big — 5MB max'); return; }
              ctl.close();
              MP.toast('Uploading audio…');
              try {
                const b64 = await blobToBase64(file);
                const asset = await MP.api('/api/uploads', { method: 'POST', body: { kind: 'audio', mime: file.type || 'audio/mpeg', data: b64 } });
                MP.toast('Uploaded ✓');
                onDone(asset.id);
              } catch (err) {
                MP.toast(err.message);
              }
            });
            input.click();
          },
        },
      ],
    });
  }

  // --------------------------------------------------------------- cursor

  function openCursor() {
    const content = document.createElement('div');
    const label = document.createElement('div');
    label.className = 'mp-label';
    label.textContent = 'Presets — visitors feel it too';
    content.appendChild(label);
    const grid = document.createElement('div');
    grid.className = 'mp-doors';
    let ctl;
    (catalog.cursors || []).forEach((c) => {
      const door = document.createElement('button');
      door.className = 'mp-door' + (doc.cursor && doc.cursor.type === 'preset' && doc.cursor.key === c.key ? ' mp-door-on' : '');
      door.innerHTML = `<span class="mp-door-emoji">${c.config.emoji}</span><span>${MP.escapeHtml(c.name)}</span>`;
      door.addEventListener('click', () => {
        doc.cursor = { type: 'preset', key: c.key };
        markDirty();
        MP.toast('Cursor set: ' + c.name);
        ctl.close();
      });
      grid.appendChild(door);
    });
    content.appendChild(grid);

    const drawLabel = document.createElement('div');
    drawLabel.className = 'mp-label';
    drawLabel.textContent = 'Or draw your own (32×32)';
    content.appendChild(drawLabel);
    const editorMount = document.createElement('div');
    content.appendChild(editorMount);
    const pixel = MPCursor.buildPixelEditor(editorMount, doc.cursor && doc.cursor.type === 'pixels' ? doc.cursor.grid : null);

    ctl = MP.openModal({
      title: '🖱 your cursor',
      contentEl: content,
      actions: [
        { label: 'Close' },
        {
          label: 'No cursor',
          onClick(c2) { doc.cursor = null; markDirty(); c2.close(); },
        },
        {
          label: 'Use my drawing', accent: true,
          onClick(c2) {
            const grid = pixel.getGrid();
            if (!grid.replace(/\./g, '').length) { MP.toast('Draw a few pixels first'); return; }
            doc.cursor = { type: 'pixels', grid, trail: null };
            markDirty();
            MP.toast('Cursor set: your drawing ✓');
            c2.close();
          },
        },
      ],
    });
  }

  // ----------------------------------------------------------------- vibes

  function openVibes() {
    const content = document.createElement('div');
    content.innerHTML = `<p class="mp-muted" style="font-size:13px;">A vibe replaces your page’s decoration with a fully worked look — every element stays hand-editable after.</p>`;
    const grid = document.createElement('div');
    grid.className = 'mp-vibe-grid';
    let ctl;
    (catalog.templates || []).forEach((t) => {
      const cell = document.createElement('button');
      cell.className = 'mp-vibe-cell';
      const preview = document.createElement('div');
      preview.className = 'mp-vibe-preview';
      const firstBg = t.content && t.content.sections && t.content.sections[0] && t.content.sections[0].background;
      const css = R().bgToCss(firstBg);
      for (const k in css) preview.style[k] = css[k];
      const name = document.createElement('div');
      name.className = 'mp-vibe-name';
      name.textContent = t.name;
      const desc = document.createElement('div');
      desc.className = 'mp-vibe-desc';
      desc.textContent = t.description || '';
      cell.append(preview, name, desc);
      cell.addEventListener('click', () => {
        ctl.close();
        MP.openModal({
          title: 'Use “' + t.name + '”?',
          contentEl: (() => {
            const d = document.createElement('p');
            d.className = 'mp-muted';
            d.style.fontSize = '13.5px';
            d.textContent = 'This replaces your current sections, cursor and footer with the template (your title and song survive). There’s no undo.';
            return d;
          })(),
          actions: [
            { label: 'Keep mine' },
            {
              label: 'Redecorate', accent: true,
              onClick(c2) {
                const t2 = deep(t.content);
                doc.sections = t2.sections;
                doc.cursor = t2.cursor;
                doc.footerStyle = t2.footerStyle;
                if (!doc.song && t2.song) doc.song = t2.song;
                deselect();
                markDirty();
                renderCanvas();
                c2.close();
                MP.toast('✨ redecorated — now make it yours');
              },
            },
          ],
        });
      });
      grid.appendChild(cell);
    });
    content.appendChild(grid);
    ctl = MP.openModal({ title: '✨ vibe templates', contentEl: content, actions: [{ label: 'Close' }] });
  }

  // --------------------------------------------------------------- footer

  function openFooterStyle() {
    const content = document.createElement('div');
    content.innerHTML = `<p class="mp-muted" style="font-size:13px;">Every page carries the “made in MyPage — make your own” mark. Restyle it to match your page; it can’t be removed (it’s how new decorators find the door).</p>`;
    const row = document.createElement('div');
    row.className = 'mp-panel-row';
    row.style.flexWrap = 'wrap';
    FOOTER_STYLES.forEach((fs) => {
      const b = document.createElement('button');
      b.className = 'mp-footer-swatch';
      b.style.background = fs.bg;
      b.style.color = fs.color;
      b.textContent = 'made in MyPage';
      b.addEventListener('click', () => {
        doc.footerStyle = { bg: fs.bg, color: fs.color };
        markDirty();
        renderCanvas();
      });
      row.appendChild(b);
    });
    content.appendChild(row);
    MP.openModal({ title: '🏷 footer mark', contentEl: content, actions: [{ label: 'Done' }] });
  }

  // ---------------------------------------------------- guestbook manager

  async function openGuestbookManager() {
    if (isLocal) return;
    let data;
    try {
      data = await MP.api('/api/pages/' + page.id + '/guestbook');
    } catch (err) { MP.toast(err.message); return; }

    const content = document.createElement('div');
    const closedRow = document.createElement('label');
    closedRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:10px;padding:6px 0;font-size:14px;font-weight:600;cursor:pointer;';
    const closedText = document.createElement('span');
    closedText.textContent = 'Close the book (no new signs)';
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.className = 'un-switch';
    toggle.checked = !!data.guestbook_closed;
    toggle.addEventListener('change', async () => {
      try {
        await MP.api('/api/pages/' + page.id, { method: 'PUT', body: { guestbook_closed: toggle.checked } });
        MP.toast(toggle.checked ? '📕 book closed' : '📖 book open');
      } catch (err) { MP.toast(err.message); toggle.checked = !toggle.checked; }
    });
    closedRow.append(closedText, toggle);
    content.appendChild(closedRow);

    const list = document.createElement('div');
    content.appendChild(list);
    function renderEntries() {
      list.textContent = '';
      if (!data.entries.length) {
        const none = document.createElement('p');
        none.className = 'mp-muted';
        none.style.cssText = 'text-align:center;padding:18px 0;font-size:13.5px;';
        none.textContent = 'no signs yet — share your page’s link';
        list.appendChild(none);
        return;
      }
      data.entries.forEach((entry) => {
        const row = document.createElement('div');
        row.className = 'mp-gbm-row' + (entry.status === 'pending' ? ' mp-gbm-pending' : '');
        const meta = document.createElement('div');
        const name = document.createElement('b');
        name.textContent = entry.author_name;
        const body = document.createElement('div');
        body.style.fontSize = '13.5px';
        body.textContent = entry.body;
        meta.append(name, body);
        const acts = document.createElement('div');
        acts.className = 'mp-gbm-acts';
        if (entry.status === 'pending') {
          const ok = document.createElement('button');
          ok.className = 'mp-chip mp-chip-btn mp-chip-strong';
          ok.textContent = '✓ approve';
          ok.addEventListener('click', async () => {
            try {
              await MP.api(`/api/pages/${page.id}/guestbook/${entry.id}/approve`, { method: 'POST', body: {} });
              entry.status = 'approved';
              renderEntries();
            } catch (err) { MP.toast(err.message); }
          });
          acts.appendChild(ok);
        }
        const del = document.createElement('button');
        del.className = 'mp-chip mp-chip-btn mp-chip-danger';
        del.textContent = '🗑';
        del.addEventListener('click', async () => {
          try {
            await MP.api(`/api/pages/${page.id}/guestbook/${entry.id}`, { method: 'DELETE' });
            data.entries = data.entries.filter((x) => x.id !== entry.id);
            renderEntries();
          } catch (err) { MP.toast(err.message); }
        });
        acts.appendChild(del);
        row.append(meta, acts);
        list.appendChild(row);
      });
    }
    renderEntries();
    MP.openModal({ title: '📖 guestbook', contentEl: content, actions: [{ label: 'Done' }] });
  }

  // -------------------------------------------------------------- sections

  function openSectionModal(si) {
    const section = doc.sections[si];
    const content = document.createElement('div');

    const label1 = document.createElement('div');
    label1.className = 'mp-label';
    label1.textContent = 'Background';
    content.appendChild(label1);

    const grid = document.createElement('div');
    grid.className = 'mp-bg-grid';
    BG_PRESETS.forEach((preset) => {
      const cell = document.createElement('button');
      cell.className = 'mp-bg-cell';
      const css = R().bgToCss(preset);
      for (const k in css) cell.style[k] = css[k];
      cell.addEventListener('click', () => {
        section.background = deep(preset);
        R().applyBg(sectionEl(si), section.background);
        markDirty();
      });
      grid.appendChild(cell);
    });
    content.appendChild(grid);

    const row = document.createElement('div');
    row.className = 'mp-panel-row';
    row.style.marginTop = '8px';
    const custom = document.createElement('input');
    custom.type = 'color';
    custom.className = 'mp-swatch mp-swatch-custom';
    custom.value = /^#[0-9a-fA-F]{6}$/.test(section.background && section.background.color) ? section.background.color : '#FAF6EE';
    custom.addEventListener('input', () => {
      section.background = { type: 'solid', color: custom.value };
      R().applyBg(sectionEl(si), section.background);
      markDirty();
    });
    let ctl;
    const photoBg = document.createElement('button');
    photoBg.className = 'mp-chip mp-chip-btn';
    photoBg.textContent = '🖼 photo background';
    photoBg.addEventListener('click', () => { ctl.close(); pickImage(si, true); });
    const tileToggle = document.createElement('button');
    tileToggle.className = 'mp-chip mp-chip-btn';
    tileToggle.textContent = '🔁 tile it';
    tileToggle.addEventListener('click', () => {
      if (section.background && section.background.type === 'image') {
        section.background.tile = !section.background.tile;
        R().applyBg(sectionEl(si), section.background);
        markDirty();
      } else {
        MP.toast('Pick a photo background first');
      }
    });
    row.append(custom, photoBg, tileToggle);
    content.appendChild(row);

    const label3 = document.createElement('div');
    label3.className = 'mp-label';
    label3.textContent = 'Section height';
    content.appendChild(label3);
    const hSlider = document.createElement('input');
    hSlider.type = 'range'; hSlider.min = '240'; hSlider.max = '1200';
    hSlider.value = String(Number(section.minHeight) || 420);
    hSlider.className = 'mp-slider';
    hSlider.style.width = '100%';
    hSlider.addEventListener('input', () => {
      section.minHeight = +hSlider.value;
      const el = sectionEl(si);
      el.dataset.minHeight = String(section.minHeight);
      R().fitSection(el);
      markDirty();
    });
    content.appendChild(hSlider);

    const rowActs = document.createElement('div');
    rowActs.className = 'mp-panel-row';
    rowActs.style.marginTop = '14px';
    const mkAct = (label, fn, danger) => {
      const b = document.createElement('button');
      b.className = 'mp-chip mp-chip-btn' + (danger ? ' mp-chip-danger' : '');
      b.textContent = label;
      b.addEventListener('click', fn);
      return b;
    };
    if (si > 0) rowActs.appendChild(mkAct('⬆ move up', () => {
      const [sec] = doc.sections.splice(si, 1);
      doc.sections.splice(si - 1, 0, sec);
      deselect(); markDirty(); renderCanvas(); ctl.close();
    }));
    if (si < doc.sections.length - 1) rowActs.appendChild(mkAct('⬇ move down', () => {
      const [sec] = doc.sections.splice(si, 1);
      doc.sections.splice(si + 1, 0, sec);
      deselect(); markDirty(); renderCanvas(); ctl.close();
    }));
    if (doc.sections.length > 1) rowActs.appendChild(mkAct('🗑 delete section', () => {
      doc.sections.splice(si, 1);
      deselect(); markDirty(); renderCanvas(); ctl.close();
    }, true));
    content.appendChild(rowActs);

    ctl = MP.openModal({ title: 'Section', contentEl: content, actions: [{ label: 'Done' }] });
  }

  // --------------------------------------------------------------- publish

  function openPublish() {
    if (isLocal) {
      // The account ask arrives at publish — the moment there's something
      // you'd hate to lose. The draft waits in localStorage and imports
      // automatically once signed in.
      const content = document.createElement('div');
      content.innerHTML = `
        <p style="font-size:14.5px;">Your page is ready for a home. Publishing needs a (free) Usernode account — <b>your draft is saved on this device and comes with you</b>.</p>
        <p class="mp-muted" style="font-size:13px;">Open MyPage inside Usernode and you’ll be offered this draft to import, decorations and all.</p>`;
      MP.openModal({
        title: 'Publish your page',
        contentEl: content,
        actions: [
          { label: 'Keep decorating' },
          {
            label: 'Open in Usernode', accent: true,
            onClick() { location.href = 'https://social-vibecoding.usernodelabs.org/#app/mypage-777ed2/full'; },
          },
        ],
      });
      return;
    }
    const content = document.createElement('div');
    const isPub = page.published;
    content.innerHTML = `
      <p class="mp-muted" style="font-size:13.5px;">${isPub
        ? 'This page is live. You can change its handle — the old link stops working.'
        : 'Pick the handle for your page’s link. Anyone with the link can visit — no account needed.'}</p>
      <label class="mp-label">Handle</label>
      <div class="mp-slug-row"><span class="mp-slug-prefix">/p/</span><input id="mp-slug" class="mp-input" maxlength="30" spellcheck="false" autocapitalize="off"></div>
      <p id="mp-slug-err" class="mp-form-err"></p>
    `;
    const input = content.querySelector('#mp-slug');
    input.value = page.slug || MP.slugify(page.title);
    const errEl = content.querySelector('#mp-slug-err');

    MP.openModal({
      title: isPub ? 'Published page' : 'Publish this page',
      contentEl: content,
      actions: [
        { label: 'Cancel' },
        {
          label: isPub ? 'Update handle' : 'Publish', accent: true,
          async onClick(ctl, btn) {
            const slug = input.value.trim().toLowerCase();
            errEl.textContent = '';
            btn.disabled = true;
            try {
              if (dirty) await save();
              const res = await MP.api('/api/pages/' + page.id + '/publish', { method: 'POST', body: { slug } });
              page = Object.assign(page, res.page);
              refreshTopbar();
              ctl.close();
              openPublished();
            } catch (err) {
              btn.disabled = false;
              errEl.textContent = err.message;
            }
          },
        },
      ],
    });
    setTimeout(() => input.focus(), 60);
  }

  function openPublished() {
    const url = location.origin + '/p/' + page.slug;
    const content = document.createElement('div');
    content.innerHTML = `
      <p style="font-size:15px;">🎉 <b>${MP.escapeHtml(page.title)}</b> is live — anyone with the link can visit, no account needed.</p>
      <div class="mp-linkbox">${MP.escapeHtml(url)}</div>
    `;
    MP.openModal({
      title: 'Your page is live',
      contentEl: content,
      actions: [
        {
          label: 'Copy link',
          onClick(_ctl, btn) {
            navigator.clipboard && navigator.clipboard.writeText(url).then(
              () => { btn.textContent = 'Copied ✓'; },
              () => { MP.toast('Couldn’t copy — long-press the link instead'); }
            );
          },
        },
        { label: 'Visit it ↗', onClick() { window.open('/p/' + page.slug, '_blank'); } },
        { label: 'Done', accent: true },
      ],
    });
  }

  window.MPEditor = { open };
})();
