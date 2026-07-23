// MPCursor — custom page cursors: catalog presets (emoji + optional trail)
// and hand-drawn 32×32 pixel cursors. Rendering path is always pixel-array
// or emoji → canvas → PNG data URI → CSS cursor; no user-supplied URLs.
// On touch devices the cursor becomes a tap-effect in the same art.
(function () {
  'use strict';

  // Fixed 16-color palette for pixel cursors. A drawn cursor is stored in
  // the page doc as a 1024-char string: '.' = transparent, 0-f = palette.
  const PALETTE = [
    '#000000', '#FFFFFF', '#1F2B47', '#D65A9E', '#FF6B57', '#C9A227',
    '#FFE93F', '#7FB542', '#2E9E8F', '#3F97E8', '#8A6FDF', '#FFD9F2',
    '#8A5A2B', '#F3EDDF', '#FF9DE2', '#7CFCD0',
  ];
  const GRID_RE = /^[.0-9a-f]{1024}$/;

  const TRAIL_GLYPHS = { sparkle: '✦', paws: '🐾', hearts: '💗' };

  let cursorCatalog = {};
  function setCatalog(catalog) {
    cursorCatalog = {};
    (catalog && catalog.cursors || []).forEach((c) => { cursorCatalog[c.key] = c.config; });
  }

  function emojiToDataUri(emoji, size) {
    const c = document.createElement('canvas');
    c.width = c.height = size || 32;
    const g = c.getContext('2d');
    g.font = Math.round(c.width * 0.85) + 'px serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(emoji, c.width / 2, c.height / 2 + 2);
    return c.toDataURL('image/png');
  }

  function gridToDataUri(grid) {
    if (typeof grid !== 'string' || !GRID_RE.test(grid)) return null;
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const g = c.getContext('2d');
    for (let i = 0; i < 1024; i++) {
      const ch = grid[i];
      if (ch === '.') continue;
      g.fillStyle = PALETTE[parseInt(ch, 16)];
      g.fillRect(i % 32, Math.floor(i / 32), 1, 1);
    }
    return c.toDataURL('image/png');
  }

  function resolve(cursor) {
    if (!cursor || typeof cursor !== 'object') return null;
    if (cursor.type === 'preset') {
      const cfg = cursorCatalog[cursor.key];
      if (!cfg) return null;
      return { uri: emojiToDataUri(cfg.emoji), trail: cfg.trail || null, glyph: cfg.emoji };
    }
    if (cursor.type === 'pixels') {
      const uri = gridToDataUri(cursor.grid);
      if (!uri) return null;
      return { uri, trail: cursor.trail === 'sparkle' ? 'sparkle' : null, glyph: null, gridUri: uri };
    }
    return null;
  }

  let detach = null;

  // Applies the page's cursor to `root` (usually document.body): CSS cursor
  // + pointer trail on mouse devices, tap-effect on touch.
  function apply(cursor, root) {
    if (detach) { detach(); detach = null; }
    const resolved = resolve(cursor);
    if (!resolved) { root.style.cursor = ''; return; }
    root.style.cursor = `url("${resolved.uri}") 4 4, auto`;

    const handlers = [];
    let lastTrail = 0;
    if (resolved.trail) {
      const onMove = (e) => {
        const now = performance.now();
        if (now - lastTrail < 70) return;
        lastTrail = now;
        spawn('mp-trail', TRAIL_GLYPHS[resolved.trail] || '✦', e.clientX, e.clientY);
      };
      document.addEventListener('pointermove', onMove);
      handlers.push(() => document.removeEventListener('pointermove', onMove));
    }
    const onTouch = (e) => {
      const t = e.touches && e.touches[0];
      if (!t) return;
      if (resolved.glyph) spawn('mp-tap', resolved.glyph, t.clientX, t.clientY);
      else if (resolved.gridUri) spawnImg(resolved.gridUri, t.clientX, t.clientY);
    };
    document.addEventListener('touchstart', onTouch, { passive: true });
    handlers.push(() => document.removeEventListener('touchstart', onTouch));

    detach = () => { handlers.forEach((h) => h()); root.style.cursor = ''; };
  }

  function spawn(cls, glyph, x, y) {
    const el = document.createElement('span');
    el.className = cls;
    el.textContent = glyph;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 900);
  }

  function spawnImg(uri, x, y) {
    const el = document.createElement('img');
    el.className = 'mp-tap';
    el.src = uri;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.style.width = '40px';
    el.style.imageRendering = 'pixelated';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 700);
  }

  // ------------------------------------------------ 32×32 pixel editor

  // Builds the pixel-editor UI into `mount`; returns { getGrid }.
  function buildPixelEditor(mount, initialGrid) {
    let grid = (typeof initialGrid === 'string' && GRID_RE.test(initialGrid))
      ? initialGrid.split('')
      : new Array(1024).fill('.');
    let color = '2';
    let drawing = false;

    const wrap = document.createElement('div');
    wrap.className = 'mp-pixel-editor';

    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 32;
    canvas.className = 'mp-pixel-canvas';
    const g = canvas.getContext('2d');

    function paintAll() {
      g.clearRect(0, 0, 32, 32);
      for (let i = 0; i < 1024; i++) {
        if (grid[i] === '.') continue;
        g.fillStyle = PALETTE[parseInt(grid[i], 16)];
        g.fillRect(i % 32, Math.floor(i / 32), 1, 1);
      }
    }
    paintAll();

    function cellFromEvent(e) {
      const r = canvas.getBoundingClientRect();
      const x = Math.floor(((e.clientX - r.left) / r.width) * 32);
      const y = Math.floor(((e.clientY - r.top) / r.height) * 32);
      if (x < 0 || x > 31 || y < 0 || y > 31) return -1;
      return y * 32 + x;
    }
    function dab(e) {
      const i = cellFromEvent(e);
      if (i < 0) return;
      grid[i] = color;
      paintAll();
    }
    canvas.addEventListener('pointerdown', (e) => {
      drawing = true;
      try { canvas.setPointerCapture(e.pointerId); } catch {}
      dab(e);
      e.preventDefault();
    });
    canvas.addEventListener('pointermove', (e) => { if (drawing) dab(e); });
    canvas.addEventListener('pointerup', () => { drawing = false; });
    canvas.addEventListener('pointercancel', () => { drawing = false; });

    const palette = document.createElement('div');
    palette.className = 'mp-pixel-palette';
    const swatches = [];
    PALETTE.forEach((hex, i) => {
      const sw = document.createElement('button');
      sw.type = 'button';
      sw.className = 'mp-swatch';
      sw.style.background = hex;
      sw.addEventListener('click', () => { color = i.toString(16); mark(sw); });
      palette.appendChild(sw);
      swatches.push(sw);
    });
    const eraser = document.createElement('button');
    eraser.type = 'button';
    eraser.className = 'mp-chip mp-chip-btn';
    eraser.textContent = '⌫ erase';
    eraser.addEventListener('click', () => { color = '.'; mark(eraser); });
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'mp-chip mp-chip-btn';
    clear.textContent = '🗑 clear';
    clear.addEventListener('click', () => { grid = new Array(1024).fill('.'); paintAll(); });
    palette.append(eraser, clear);
    function mark(active) {
      swatches.concat([eraser]).forEach((el) => el.classList.remove('mp-swatch-on', 'mp-chip-on'));
      active.classList.add(active === eraser ? 'mp-chip-on' : 'mp-swatch-on');
    }
    mark(swatches[2]);

    wrap.append(canvas, palette);
    mount.appendChild(wrap);
    return { getGrid: () => grid.join('') };
  }

  window.MPCursor = { apply, setCatalog, emojiToDataUri, gridToDataUri, buildPixelEditor, PALETTE };
})();
