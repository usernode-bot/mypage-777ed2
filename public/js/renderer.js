// PageRenderer — the one true page-document → DOM renderer.
// Used by the editor canvas, the in-app preview and the public viewer
// (view.html). SAFETY CONTRACT: page documents are user-controlled JSON
// rendered on public URLs — user strings only ever go through textContent,
// colors are whitelisted to hex, fonts/styles to a fixed palette, image
// sources to /assets/<int>, link URLs to http(s), and sticker art comes
// only from the app's own catalog. Never innerHTML anything from the doc.
(function () {
  'use strict';

  const FONTS = {
    inter: "'Inter', system-ui, sans-serif",
    fraunces: "'Fraunces', Georgia, serif",
    comic: "'Comic Neue', 'Comic Sans MS', cursive",
    hand: "'Caveat', cursive",
    typewriter: "'Special Elite', 'Courier New', monospace",
    pixel: "'Press Start 2P', monospace",
  };

  const HEX_RE = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

  // Catalog (stickers by key) — set once after fetching /api/public/catalog.
  let stickerMap = {};
  function setCatalog(catalog) {
    stickerMap = {};
    (catalog && catalog.stickerPacks || []).forEach((pack) => {
      (pack.stickers || []).forEach((st) => { stickerMap[st.key] = st.svg; });
    });
  }

  function safeColor(c, fallback) {
    return (typeof c === 'string' && HEX_RE.test(c)) ? c : fallback;
  }

  function safeUrl(u) {
    if (typeof u !== 'string') return null;
    try {
      const parsed = new URL(u, location.origin);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.href;
    } catch {}
    return null;
  }

  function clamp(n, lo, hi, fb) {
    n = Number(n);
    if (!Number.isFinite(n)) return fb;
    return Math.min(hi, Math.max(lo, n));
  }

  function bgToCss(bg) {
    bg = bg && typeof bg === 'object' ? bg : {};
    const c1 = safeColor(bg.color || bg.from, '#FAF6EE');
    const c2 = safeColor(bg.color2 || bg.to, '#F3EDDF');
    const angle = clamp(bg.angle, 0, 360, 160);
    if (bg.type === 'gradient') {
      return { background: `linear-gradient(${angle}deg, ${c1}, ${c2})` };
    }
    if (bg.type === 'image' && Number.isInteger(bg.assetId)) {
      const base = { backgroundColor: c1, backgroundImage: `url("/assets/${bg.assetId}")` };
      if (bg.tile) { base.backgroundSize = clamp(bg.tileSize, 40, 600, 220) + 'px'; base.backgroundRepeat = 'repeat'; }
      else { base.backgroundSize = 'cover'; base.backgroundPosition = 'center'; }
      return base;
    }
    if (bg.type === 'pattern') {
      const ink = safeColor(bg.ink, '#E7DFCC');
      switch (bg.pattern) {
        case 'dots':
          return { backgroundColor: c1, backgroundImage: `radial-gradient(${ink} 1.6px, transparent 1.6px)`, backgroundSize: '22px 22px' };
        case 'stripes':
          return { backgroundColor: c1, backgroundImage: `repeating-linear-gradient(${angle}deg, ${ink} 0 10px, transparent 10px 28px)` };
        case 'checker':
          return { backgroundColor: c1, backgroundImage: `conic-gradient(${ink} 25%, transparent 0 50%, ${ink} 0 75%, transparent 0)`, backgroundSize: '28px 28px' };
        case 'grid':
          return { backgroundColor: c1, backgroundImage: `linear-gradient(${ink} 1px, transparent 1px), linear-gradient(90deg, ${ink} 1px, transparent 1px)`, backgroundSize: '26px 26px' };
        default:
          return { background: c1 };
      }
    }
    return { background: c1 };
  }

  function applyBg(el, bg) {
    el.style.background = '';
    el.style.backgroundColor = '';
    el.style.backgroundImage = '';
    el.style.backgroundSize = '';
    el.style.backgroundRepeat = '';
    el.style.backgroundPosition = '';
    const css = bgToCss(bg);
    for (const k in css) el.style[k] = css[k];
  }

  function applyBlockGeometry(el, block) {
    el.style.left = clamp(block.x, -20, 110, 4) + '%';
    el.style.top = clamp(block.y, 0, 8000, 20) + 'px';
    el.style.width = clamp(block.w, 4, 120, 60) + '%';
    el.style.zIndex = String(Math.round(clamp(block.z, 1, 200, 1)));
    el.style.transform = `rotate(${clamp(block.rotation, -180, 180, 0)}deg)`;
  }

  function applyTextProps(el, props) {
    const p = props && typeof props === 'object' ? props : {};
    el.textContent = typeof p.text === 'string' ? p.text.slice(0, 4000) : '';
    el.style.fontFamily = FONTS[p.font] || FONTS.inter;
    el.style.fontSize = clamp(p.size, 10, 120, 20) + 'px';
    el.style.fontWeight = p.bold ? '700' : '400';
    el.style.textAlign = ['left', 'center', 'right'].includes(p.align) ? p.align : 'left';
    el.classList.remove('mp-tx-rainbow', 'mp-tx-sparkle', 'mp-tx-shadow');
    el.style.webkitTextStroke = '';
    const color = safeColor(p.color, '#1F2B47');
    switch (p.style) {
      case 'rainbow':
        el.classList.add('mp-tx-rainbow');
        el.style.color = '';
        break;
      case 'sparkle':
        el.classList.add('mp-tx-sparkle');
        el.style.color = color;
        break;
      case 'shadow':
        el.classList.add('mp-tx-shadow');
        el.style.color = color;
        break;
      case 'outline':
        el.style.webkitTextStroke = `1.5px ${color}`;
        el.style.color = 'transparent';
        break;
      default:
        el.style.color = color;
    }
  }

  function renderBlock(block, ctx) {
    const el = document.createElement('div');
    el.className = 'mp-block';
    el.dataset.blockId = String(block.id || '');
    applyBlockGeometry(el, block);
    const props = block.props && typeof block.props === 'object' ? block.props : {};

    if (block.type === 'text') {
      const t = document.createElement('div');
      t.className = 'mp-text';
      applyTextProps(t, props);
      el.appendChild(t);
    } else if (block.type === 'image') {
      const wrap = document.createElement('div');
      wrap.className = 'mp-image';
      if (Number.isInteger(props.assetId)) {
        const img = document.createElement('img');
        img.src = '/assets/' + props.assetId; // only ever our own asset route
        img.alt = typeof props.alt === 'string' ? props.alt.slice(0, 200) : '';
        img.loading = 'lazy';
        img.draggable = false;
        wrap.appendChild(img);
      }
      el.appendChild(wrap);
    } else if (block.type === 'sticker') {
      const wrap = document.createElement('div');
      wrap.className = 'mp-sticker';
      if (typeof props.emoji === 'string' && props.emoji.trim()) {
        // Emoji sticker: user-chosen glyph rendered through an SVG built
        // with createElementNS + textContent — scales like catalog art,
        // never innerHTML'd.
        const SVGNS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(SVGNS, 'svg');
        svg.setAttribute('viewBox', '0 0 100 100');
        svg.setAttribute('class', 'mp-sticker-emoji');
        const t = document.createElementNS(SVGNS, 'text');
        t.setAttribute('x', '50');
        t.setAttribute('y', '50');
        t.setAttribute('text-anchor', 'middle');
        t.setAttribute('dominant-baseline', 'central');
        t.setAttribute('font-size', '76');
        t.textContent = [...props.emoji.trim()].slice(0, 4).join('');
        svg.appendChild(t);
        wrap.appendChild(svg);
      } else {
        const svg = stickerMap[props.key];
        // Catalog SVG is app-shipped content (seeded by the app itself),
        // keyed by a whitelist lookup — never user-supplied markup.
        if (svg) wrap.innerHTML = svg;
      }
      el.appendChild(wrap);
    } else if (block.type === 'widget' && window.MPWidgets) {
      el.appendChild(window.MPWidgets.render(props, ctx || {}));
    }
    return el;
  }

  // Blocks live inside a centered content column while the section's
  // background bleeds full width. Returns the column for a section el
  // (tolerates being handed the column itself, or legacy flat markup).
  function sectionContent(secEl) {
    if (!secEl) return null;
    if (secEl.classList.contains('mp-section-content')) return secEl;
    return secEl.querySelector(':scope > .mp-section-content') || secEl;
  }

  // Absolute-positioned blocks don't grow their section, so after layout
  // settles we size each section to max(minHeight, deepest block bottom).
  // Height is set on the content column; the full-bleed wrapper follows.
  function fitSection(secEl) {
    const inner = sectionContent(secEl);
    const rect = inner.getBoundingClientRect();
    let need = 0;
    inner.querySelectorAll(':scope > .mp-block').forEach((b) => {
      const r = b.getBoundingClientRect();
      need = Math.max(need, r.bottom - rect.top);
    });
    const minH = parseFloat((secEl.dataset && secEl.dataset.minHeight) || inner.dataset.minHeight || '320');
    inner.style.height = Math.max(minH, Math.ceil(need) + 28) + 'px';
  }

  function fitSections(mount) {
    mount.querySelectorAll('.mp-section').forEach(fitSection);
  }

  function renderFooter(doc, ctx) {
    const footer = document.createElement('div');
    footer.className = 'mp-footer';
    const fs = (ctx && ctx.footerStyle) || (doc && doc.footerStyle) || null;
    if (fs && typeof fs === 'object') {
      const bg = safeColor(fs.bg, null);
      const color = safeColor(fs.color, null);
      if (bg) footer.style.background = bg;
      if (color) footer.style.color = color;
    }
    const span = document.createElement('span');
    span.append('made in ');
    const b = document.createElement('b');
    b.textContent = 'MyPage';
    span.appendChild(b);
    span.append(' — ');
    const a = document.createElement('a');
    a.href = '/make';
    a.textContent = 'make your own →';
    span.appendChild(a);
    footer.appendChild(span);
    if (ctx && ctx.onReport) {
      const rep = document.createElement('a');
      rep.className = 'mp-footer-report';
      rep.href = '#';
      rep.textContent = 'report this page';
      rep.addEventListener('click', (e) => { e.preventDefault(); ctx.onReport(); });
      footer.appendChild(rep);
    }
    return footer;
  }

  // render(doc, mount, ctx) — ctx flows into widgets:
  //   { visits, song, editing, guestbook: {...}, footer: bool, footerStyle, onReport }
  function render(doc, mount, ctx) {
    mount.textContent = '';
    const sections = (doc && Array.isArray(doc.sections)) ? doc.sections : [];
    const widgetCtx = Object.assign({}, ctx, { song: doc && doc.song });
    sections.forEach((section, si) => {
      const sec = document.createElement('div');
      sec.className = 'mp-section';
      sec.dataset.sectionId = String(section.id || '');
      sec.dataset.si = String(si);
      sec.dataset.minHeight = String(clamp(section.minHeight, 120, 3000, 320));
      applyBg(sec, section.background);
      // Full-bleed background, blocks in a centered mobile-width column.
      const inner = document.createElement('div');
      inner.className = 'mp-section-content';
      const blocks = Array.isArray(section.blocks) ? section.blocks : [];
      blocks.forEach((block, bi) => {
        const el = renderBlock(block, widgetCtx);
        el.dataset.si = String(si);
        el.dataset.bi = String(bi);
        inner.appendChild(el);
      });
      sec.appendChild(inner);
      mount.appendChild(sec);
    });
    if (ctx && ctx.footer) mount.appendChild(renderFooter(doc, ctx));
    // Fonts/layout may still be settling; fit now and once more next frame.
    fitSections(mount);
    requestAnimationFrame(() => fitSections(mount));
  }

  window.PageRenderer = {
    render,
    renderBlock,
    fitSection,
    fitSections,
    sectionContent,
    applyBlockGeometry,
    applyTextProps,
    applyBg,
    bgToCss,
    safeColor,
    safeUrl,
    clamp,
    setCatalog,
    getSticker: (key) => stickerMap[key],
    FONTS,
  };
})();
