// The MyPage editor: stacked sections, per-section backgrounds, freely
// placed text blocks with drag / rotate / resize / layering, autosaving
// drafts and publish-with-slug. Rendering goes through the shared
// PageRenderer so the editor preview and the (future) public view can
// never drift apart.
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
    { type: 'pattern', pattern: 'dots', color: '#FAF6EE', ink: '#E7DFCC' },
    { type: 'pattern', pattern: 'stripes', color: '#FFF4F9', ink: '#F4C7DE', angle: 45 },
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

  let page = null;
  let doc = null;
  let canvas = null;
  let sel = null; // { si, bi }
  let saveTimer = null;
  let saving = false;
  let dirty = false;
  let gesture = null;

  const uid = (p) => p + '-' + Math.random().toString(36).slice(2, 8);

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

  // ------------------------------------------------------------------ open

  async function open(id) {
    const app = document.getElementById('app');
    app.innerHTML = `
      <header class="mp-topbar">
        <button id="mp-back" class="mp-iconbtn" aria-label="Back">←</button>
        <button id="mp-title" class="mp-topbar-title"></button>
        <span id="mp-savestate" class="mp-savestate"></span>
        <button id="mp-menu" class="mp-iconbtn" aria-label="Page menu">⋯</button>
        <button id="mp-publish" class="mp-btn mp-btn-accent mp-btn-sm">Publish</button>
      </header>
      <div id="mp-canvas-wrap">
        <div id="mp-canvas" class="mp-editing" data-testid="editor-canvas"></div>
        <button id="mp-add-section" class="mp-add-section">＋ add a section</button>
        <div style="height:150px"></div>
      </div>
      <div id="mp-panel" class="mp-panel"></div>
    `;
    canvas = document.getElementById('mp-canvas');
    sel = null; dirty = false; saving = false; gesture = null;
    clearTimeout(saveTimer);

    document.getElementById('mp-back').addEventListener('click', async () => {
      if (dirty) await save();
      MP.navigate('/');
    });
    document.getElementById('mp-title').addEventListener('click', openRename);
    document.getElementById('mp-publish').addEventListener('click', openPublish);
    document.getElementById('mp-menu').addEventListener('click', openMenu);
    document.getElementById('mp-add-section').addEventListener('click', addSection);

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('dblclick', (e) => {
      const blockEl = e.target.closest('.mp-block');
      if (blockEl) { selectBlock(+blockEl.dataset.si, +blockEl.dataset.bi); openTextModal(); }
    });

    try {
      ({ page } = await MP.api('/api/pages/' + id));
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
    renderCanvas();
    renderPanel();
  }

  function refreshTopbar() {
    document.getElementById('mp-title').textContent = page.title;
    const pub = document.getElementById('mp-publish');
    pub.textContent = page.published ? 'Published ✓' : 'Publish';
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
    if (saving) { markDirty(); return; }
    clearTimeout(saveTimer);
    saving = true;
    setSaveState('saving…');
    try {
      await MP.api('/api/pages/' + page.id, { method: 'PUT', body: { title: page.title, content: doc } });
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
    R().render(doc, canvas);
    // Per-section editor chrome: background + add-text chips.
    canvas.querySelectorAll('.mp-section').forEach((secEl) => {
      const si = +secEl.dataset.si;
      const bar = document.createElement('div');
      bar.className = 'mp-section-bar';
      const bgBtn = document.createElement('button');
      bgBtn.className = 'mp-chip mp-chip-btn';
      bgBtn.textContent = '🎨 background';
      bgBtn.addEventListener('click', () => openSectionModal(si));
      const txBtn = document.createElement('button');
      txBtn.className = 'mp-chip mp-chip-btn';
      txBtn.textContent = '＋ text';
      txBtn.addEventListener('click', () => addTextBlock(si));
      bar.append(bgBtn, txBtn);
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
      g.block.w = Math.round(clamp(g.origW + dW, 8, 120, g.origW));
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

  function addTextBlock(si) {
    const section = doc.sections[si];
    const maxZ = section.blocks.reduce((m, b) => Math.max(m, Number(b.z) || 1), 0);
    const block = {
      id: uid('b'), type: 'text', x: 8, y: 40, w: 66, rotation: 0, z: maxZ + 1,
      props: { text: 'write something…', font: 'inter', size: 22, color: '#1F2B47', bold: false, align: 'left', style: 'none' },
    };
    section.blocks.push(block);
    markDirty();
    renderCanvas();
    selectBlock(si, section.blocks.length - 1);
    openTextModal();
  }

  function addSection() {
    const preset = BG_PRESETS[(doc.sections.length + 2) % BG_PRESETS.length];
    doc.sections.push({ id: uid('s'), minHeight: 420, background: JSON.parse(JSON.stringify(preset)), blocks: [] });
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

  function updateSelectedText(mutator) {
    const block = selBlock();
    if (!block || block.type !== 'text') return;
    mutator(block.props);
    const el = blockEl(sel.si, sel.bi);
    if (el) {
      R().applyTextProps(el.querySelector('.mp-text'), block.props);
      R().fitSection(sectionEl(sel.si));
    }
    markDirty();
    renderPanel();
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

  function renderPanel() {
    const panel = document.getElementById('mp-panel');
    if (!panel) return;
    panel.textContent = '';
    const block = selBlock();

    if (!block) {
      const hint = document.createElement('div');
      hint.className = 'mp-panel-row mp-panel-hint';
      hint.innerHTML = '<span class="mp-muted">tap a block to style it · drag to move · use ＋ text on a section</span>';
      panel.appendChild(hint);
      return;
    }

    const p = block.props;

    // Row 1: edit text + fonts.
    const row1 = chipRow(FONT_CHIPS, (f) => p.font === f.key, (f) => updateSelectedText((pp) => { pp.font = f.key; }));
    const editBtn = document.createElement('button');
    editBtn.className = 'mp-chip mp-chip-btn mp-chip-strong';
    editBtn.textContent = '✏️ edit text';
    editBtn.addEventListener('click', openTextModal);
    row1.prepend(editBtn);
    panel.appendChild(row1);

    // Row 2: size slider + bold + align + styles.
    const row2 = document.createElement('div');
    row2.className = 'mp-panel-row';
    const size = document.createElement('input');
    size.type = 'range'; size.min = '10'; size.max = '96'; size.value = String(Number(p.size) || 20);
    size.className = 'mp-slider';
    size.addEventListener('input', () => updateSelectedTextQuiet((pp) => { pp.size = +size.value; }));
    size.addEventListener('change', () => renderPanel());
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

    // Row 3: colors + layers + delete.
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
    custom.addEventListener('input', () => updateSelectedTextQuiet((pp) => { pp.color = custom.value; }));
    row3.appendChild(custom);
    panel.appendChild(row3);

    const row4 = document.createElement('div');
    row4.className = 'mp-panel-row';
    const up = document.createElement('button');
    up.className = 'mp-chip mp-chip-btn'; up.textContent = '⬆ layer';
    up.addEventListener('click', () => layerSelected(1));
    const down = document.createElement('button');
    down.className = 'mp-chip mp-chip-btn'; down.textContent = '⬇ layer';
    down.addEventListener('click', () => layerSelected(-1));
    const del = document.createElement('button');
    del.className = 'mp-chip mp-chip-btn mp-chip-danger'; del.textContent = '🗑 delete';
    del.addEventListener('click', deleteSelected);
    const done = document.createElement('button');
    done.className = 'mp-chip mp-chip-btn'; done.textContent = 'done';
    done.addEventListener('click', deselect);
    row4.append(up, down, del, done);
    panel.appendChild(row4);
  }

  // Same as updateSelectedText but without re-rendering the panel (used by
  // sliders / color pickers that fire continuously).
  function updateSelectedTextQuiet(mutator) {
    const block = selBlock();
    if (!block || block.type !== 'text') return;
    mutator(block.props);
    const el = blockEl(sel.si, sel.bi);
    if (el) {
      R().applyTextProps(el.querySelector('.mp-text'), block.props);
      R().fitSection(sectionEl(sel.si));
    }
    markDirty();
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
    const input = document.createElement('input');
    input.className = 'mp-input';
    input.maxLength = 120;
    input.value = page.title;
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

  function openMenu() {
    const content = document.createElement('div');
    content.innerHTML = `<p class="mp-muted" style="font-size:13px;">Deleting removes the page and its guestbook for good.</p>`;
    MP.openModal({
      title: page.title,
      contentEl: content,
      actions: [
        { label: 'Close' },
        {
          label: 'Delete page', accent: false,
          async onClick(ctl, btn) {
            if (btn.dataset.armed !== '1') {
              btn.dataset.armed = '1';
              btn.textContent = 'Really delete?';
              btn.classList.add('mp-btn-danger');
              return;
            }
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
        section.background = JSON.parse(JSON.stringify(preset));
        R().applyBg(sectionEl(si), section.background);
        markDirty();
      });
      grid.appendChild(cell);
    });
    content.appendChild(grid);

    const label2 = document.createElement('div');
    label2.className = 'mp-label';
    label2.textContent = 'Custom color';
    content.appendChild(label2);
    const custom = document.createElement('input');
    custom.type = 'color';
    custom.className = 'mp-swatch mp-swatch-custom';
    custom.value = /^#[0-9a-fA-F]{6}$/.test(section.background && section.background.color) ? section.background.color : '#FAF6EE';
    custom.addEventListener('input', () => {
      section.background = { type: 'solid', color: custom.value };
      R().applyBg(sectionEl(si), section.background);
      markDirty();
    });
    content.appendChild(custom);

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
    let ctl;
    if (si > 0) rowActs.appendChild(mkAct('⬆ move up', () => {
      const [s] = doc.sections.splice(si, 1);
      doc.sections.splice(si - 1, 0, s);
      deselect(); markDirty(); renderCanvas(); ctl.close();
    }));
    if (si < doc.sections.length - 1) rowActs.appendChild(mkAct('⬇ move down', () => {
      const [s] = doc.sections.splice(si, 1);
      doc.sections.splice(si + 1, 0, s);
      deselect(); markDirty(); renderCanvas(); ctl.close();
    }));
    if (doc.sections.length > 1) rowActs.appendChild(mkAct('🗑 delete section', () => {
      doc.sections.splice(si, 1);
      deselect(); markDirty(); renderCanvas(); ctl.close();
    }, true));
    content.appendChild(rowActs);

    ctl = MP.openModal({ title: 'Section', contentEl: content, actions: [{ label: 'Done' }] });
  }

  function openPublish() {
    const content = document.createElement('div');
    const isPub = page.published;
    content.innerHTML = `
      <p class="mp-muted" style="font-size:13.5px;">${isPub
        ? 'This page is live. You can change its handle — the old link stops working.'
        : 'Pick the handle for your page’s link. Anyone with the link will be able to visit — no account needed.'}</p>
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
      <p style="font-size:15px;">🎉 <b>${MP.escapeHtml(page.title)}</b> is published.</p>
      <div class="mp-linkbox">${MP.escapeHtml(url)}</div>
      <p class="mp-muted" style="font-size:12.5px;margin-top:10px;">Account-less visiting for this link arrives with the public-viewing update — inside Usernode it works today.</p>
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
        { label: 'Done', accent: true },
      ],
    });
  }

  window.MPEditor = { open };
})();
