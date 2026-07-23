// PageRenderer — the one true page-document → DOM renderer.
// Used by the editor canvas today and by the public page view in the
// public-viewing phase. SAFETY CONTRACT: page documents are user-controlled
// JSON that will eventually render on public URLs — user strings only ever
// go through textContent, colors are whitelisted to hex, fonts/styles to a
// fixed palette. Never innerHTML anything from the document.
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

  function safeColor(c, fallback) {
    return (typeof c === 'string' && HEX_RE.test(c)) ? c : fallback;
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
    const css = bgToCss(bg);
    for (const k in css) el.style[k] = css[k];
  }

  function applyBlockGeometry(el, block) {
    el.style.left = clamp(block.x, -20, 110, 4) + '%';
    el.style.top = clamp(block.y, 0, 8000, 20) + 'px';
    el.style.width = clamp(block.w, 8, 120, 60) + '%';
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

  function renderBlock(block) {
    const el = document.createElement('div');
    el.className = 'mp-block';
    el.dataset.blockId = String(block.id || '');
    applyBlockGeometry(el, block);
    if (block.type === 'text') {
      const t = document.createElement('div');
      t.className = 'mp-text';
      applyTextProps(t, block.props);
      el.appendChild(t);
    }
    return el;
  }

  // Absolute-positioned blocks don't grow their section, so after layout
  // settles we size each section to max(minHeight, deepest block bottom).
  function fitSection(secEl) {
    const rect = secEl.getBoundingClientRect();
    let need = 0;
    secEl.querySelectorAll(':scope > .mp-block').forEach((b) => {
      const r = b.getBoundingClientRect();
      need = Math.max(need, r.bottom - rect.top);
    });
    const minH = parseFloat(secEl.dataset.minHeight || '320');
    secEl.style.height = Math.max(minH, Math.ceil(need) + 28) + 'px';
  }

  function fitSections(mount) {
    mount.querySelectorAll('.mp-section').forEach(fitSection);
  }

  function render(doc, mount) {
    mount.textContent = '';
    const sections = (doc && Array.isArray(doc.sections)) ? doc.sections : [];
    sections.forEach((section, si) => {
      const sec = document.createElement('div');
      sec.className = 'mp-section';
      sec.dataset.sectionId = String(section.id || '');
      sec.dataset.si = String(si);
      sec.dataset.minHeight = String(clamp(section.minHeight, 120, 3000, 320));
      applyBg(sec, section.background);
      const blocks = Array.isArray(section.blocks) ? section.blocks : [];
      blocks.forEach((block, bi) => {
        const el = renderBlock(block);
        el.dataset.si = String(si);
        el.dataset.bi = String(bi);
        sec.appendChild(el);
      });
      mount.appendChild(sec);
    });
    // Fonts/layout may still be settling; fit now and once more next frame.
    fitSections(mount);
    requestAnimationFrame(() => fitSections(mount));
  }

  window.PageRenderer = {
    render,
    fitSection,
    fitSections,
    applyBlockGeometry,
    applyTextProps,
    applyBg,
    bgToCss,
    safeColor,
    clamp,
    FONTS,
  };
})();
