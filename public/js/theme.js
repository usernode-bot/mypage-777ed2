// MPTheme — the app chrome's light/dark/system appearance preference.
//
// Signal contract (set on <html>, mirrored by the anti-FOUC snippet in the
// <head> of index.html AND view.html — this file is the source of truth):
//   class="dark"            dark is in effect (drives native.css + tailwind)
//   data-theme=light|dark   the RESOLVED theme (readable selectors / tests)
//   data-theme-mode=…       the CHOSEN mode: light | dark | system
//
// Only app chrome themes. Page documents render identically in both themes —
// the page is the artifact (see page.css / renderer.js, deliberately untouched).
(function () {
  'use strict';

  const KEY = 'mp_theme';
  const MODES = ['light', 'dark', 'system'];
  const subs = [];

  // ?theme=… is a screenshot-state / deep-link override: it applies for this
  // load only and is never written to storage, so a shared link can't
  // silently rewrite the recipient's saved choice.
  const override = MODES.indexOf(window.__mpThemeOverride) >= 0
    ? window.__mpThemeOverride : null;

  const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function stored() {
    try {
      const v = localStorage.getItem(KEY);
      return MODES.indexOf(v) >= 0 ? v : 'system';
    } catch { return 'system'; }
  }

  function mode() {
    return override || stored();
  }

  function resolved() {
    const m = mode();
    if (m === 'light' || m === 'dark') return m;
    return mq && mq.matches ? 'dark' : 'light';
  }

  function apply() {
    const r = resolved();
    const root = document.documentElement;
    root.classList.toggle('dark', r === 'dark');
    root.setAttribute('data-theme', r);
    root.setAttribute('data-theme-mode', mode());
    return r;
  }

  function set(next) {
    if (MODES.indexOf(next) < 0) return;
    try { localStorage.setItem(KEY, next); } catch {}
    // An explicit choice wins over a URL override for the rest of this load.
    if (override) window.__mpThemeOverride = null;
    notify(apply());
  }

  function notify(r) {
    subs.forEach((fn) => { try { fn(r, mode()); } catch {} });
  }

  function subscribe(fn) {
    if (typeof fn === 'function') subs.push(fn);
  }

  // Live OS switching (including sunset schedules) — only meaningful while
  // the chosen mode is `system`.
  if (mq) {
    const onChange = () => { if (mode() === 'system') notify(apply()); };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }

  // The head snippet already painted the right theme; re-assert in case this
  // file loaded standalone (or the snippet was skipped).
  apply();

  const LABELS = {
    light: { emoji: '☀️', name: 'Light' },
    dark: { emoji: '🌙', name: 'Dark' },
    system: { emoji: '🖥️', name: 'System' },
  };

  window.MPTheme = { mode, resolved, set, subscribe, MODES, LABELS };
})();
