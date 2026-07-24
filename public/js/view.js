// The public page viewer: /p/<slug> (published pages, account-less) and
// /claim/<token> (gift links). Full experience — cursor, song, widgets,
// guestbook — with the footer's "make your own" door.
(function () {
  'use strict';

  const params = new URLSearchParams(location.search);
  let token = params.get('token') || sessionStorage.getItem('mp_token') || '';
  if (params.get('token')) sessionStorage.setItem('mp_token', token);
  let username = null;
  if (token) {
    try { username = JSON.parse(atob(token.split('.')[1])).username || null; } catch {}
  }

  const mount = document.getElementById('page');
  const pathMatch = location.pathname.match(/^\/(p|claim)\/([^/]+)$/);

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...(token ? { 'x-usernode-token': token } : {}) },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch {}
    if (!res.ok) throw new Error((data && data.error) || 'Request failed (' + res.status + ')');
    return data;
  }

  function showState(title, msg, linkHome) {
    mount.innerHTML = '';
    const d = document.createElement('div');
    d.className = 'v-state';
    const h = document.createElement('h1');
    h.textContent = title;
    const p = document.createElement('p');
    p.textContent = msg;
    d.append(h, p);
    if (linkHome) {
      const a = document.createElement('a');
      a.href = '/make';
      a.textContent = 'make a page of your own →';
      d.appendChild(a);
    }
    mount.appendChild(d);
  }

  function modal(buildContent) {
    const back = document.createElement('div');
    back.className = 'v-modal-back';
    const box = document.createElement('div');
    box.className = 'v-modal';
    back.appendChild(box);
    const close = () => back.remove();
    back.addEventListener('pointerdown', (e) => { if (e.target === back) close(); });
    buildContent(box, close);
    document.body.appendChild(back);
  }

  function openReport(slug, entry) {
    modal((box, close) => {
      const h = document.createElement('h2');
      h.textContent = entry ? 'Report this guestbook note' : 'Report this page';
      box.appendChild(h);
      const reasons = entry
        ? [['other', 'It’s spam or abusive']]
        : [
            ['impersonation', 'It’s posing as someone (impersonation)'],
            ['i_am_the_subject', 'This page is about me and I want it taken down'],
            ['other', 'Something else'],
          ];
      let chosen = reasons[0][0];
      reasons.forEach(([value, label], i) => {
        const l = document.createElement('label');
        const r = document.createElement('input');
        r.type = 'radio'; r.name = 'reason'; r.checked = i === 0;
        r.addEventListener('change', () => { chosen = value; });
        const span = document.createElement('span');
        span.textContent = label;
        l.append(r, span);
        box.appendChild(l);
      });
      const detail = document.createElement('textarea');
      detail.placeholder = 'anything else we should know? (optional)';
      detail.maxLength = 1000;
      box.appendChild(detail);
      const note = document.createElement('p');
      note.className = 'v-note';
      note.textContent = 'Reports from a page’s subject remove it from the directory right away.';
      box.appendChild(note);
      const actions = document.createElement('div');
      actions.className = 'v-modal-actions';
      const cancel = document.createElement('button');
      cancel.textContent = 'Cancel';
      cancel.addEventListener('click', close);
      const send = document.createElement('button');
      send.className = 'accent';
      send.textContent = 'Send report';
      send.addEventListener('click', async () => {
        send.disabled = true;
        try {
          await api('/api/public/reports', {
            method: 'POST',
            body: { slug, entry_id: entry ? entry.id : null, reason: chosen, detail: detail.value },
          });
          box.textContent = '';
          const done = document.createElement('p');
          done.textContent = 'Thank you — the report is in. 💌';
          box.appendChild(done);
          setTimeout(close, 1400);
        } catch (err) {
          note.textContent = err.message;
          send.disabled = false;
        }
      });
      actions.append(cancel, send);
      box.appendChild(actions);
    });
  }

  function countVisit(slug) {
    // one count per page per hour per device — a cozy odometer, not analytics
    try {
      const key = 'mp_visited_' + slug;
      const last = Number(localStorage.getItem(key) || 0);
      if (Date.now() - last < 3600000) return Promise.resolve(null);
      localStorage.setItem(key, String(Date.now()));
    } catch {}
    return api('/api/public/pages/' + encodeURIComponent(slug) + '/visit', { method: 'POST', body: {} }).catch(() => null);
  }

  function renderPage(data, opts) {
    const { page, guestbook, visits } = data;
    document.title = page.title + ' · MyPage';

    mount.textContent = '';
    mount.dataset.testid = 'page-view';

    if (opts && opts.claimBar) mount.appendChild(opts.claimBar);

    if (page.made_for_name && page.made_by_username) {
      const byline = document.createElement('div');
      byline.className = 'v-byline';
      byline.textContent = `made by ${page.made_by_username} for ${page.made_for_name} 💌`;
      mount.appendChild(byline);
    }

    const canvas = document.createElement('div');
    mount.appendChild(canvas);

    const ctx = {
      visits,
      footer: true,
      footerStyle: page.footer_style,
      onReport: () => openReport(page.slug),
      guestbook: page.slug ? {
        entries: guestbook,
        closed: page.guestbook_closed,
        signedInAs: username,
        onSign: (payload) => api('/api/public/pages/' + encodeURIComponent(page.slug) + '/guestbook', { method: 'POST', body: payload }),
        onReportEntry: (entry) => openReport(page.slug, entry),
      } : null,
    };
    PageRenderer.render(page.content, canvas, ctx);
    MPCursor.apply(page.content && page.content.cursor, document.body);

    // Autoplay the page's song where the browser allows it; MPSong falls
    // back to the visitor's first gesture when the policy blocks it.
    const srcUrl = MPSong.sourceUrl(page.content && page.content.song);
    if (srcUrl) {
      const playBtn = canvas.querySelector('.mpw-song-play');
      const disc = canvas.querySelector('.mpw-song-disc');
      MPSong.autoplay(srcUrl, playBtn, disc);
    }
  }

  async function boot() {
    if (!pathMatch) { showState('✨', 'Nothing to see here.', true); return; }
    const kind = pathMatch[1];
    const id = decodeURIComponent(pathMatch[2]);
    try {
      const catalog = await api('/api/public/catalog');
      PageRenderer.setCatalog(catalog);
      MPCursor.setCatalog(catalog);
      MPSong.setCatalog(catalog);

      if (kind === 'p') {
        const data = await api('/api/public/pages/' + encodeURIComponent(id));
        renderPage(data);
        countVisit(id).then((r) => {
          if (!r || !r.total) return;
          // refresh any odometer widgets with the new total
          document.querySelectorAll('.mpw-counter-digits').forEach((digits) => {
            const s = String(r.total).padStart(4, '0');
            const bs = digits.querySelectorAll('b');
            if (bs.length === s.length) bs.forEach((b, i) => { b.textContent = s[i]; });
          });
        });
      } else {
        const data = await api('/api/public/claims/' + encodeURIComponent(id));
        renderPage(data, { claimBar: buildClaimBar(id, data) });
      }
    } catch (err) {
      showState('🕸️', err.message, true);
    }
  }

  function buildClaimBar(claimToken, data) {
    const bar = document.createElement('div');
    bar.className = 'v-claimbar';
    const b = document.createElement('b');
    if (data.gift.status !== 'pending') {
      b.textContent = 'This gift has already been claimed 💝';
      bar.appendChild(b);
      return bar;
    }
    b.textContent = `🎁 ${data.gift.created_by} made you this page`;
    const sub = document.createElement('span');
    sub.textContent = 'claim it and it’s yours to redecorate';
    bar.append(b, sub);
    const actions = document.createElement('div');
    actions.className = 'v-claim-actions';
    if (token) {
      const mk = (label, mode) => {
        const btn = document.createElement('button');
        btn.textContent = label;
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          try {
            await api('/api/claims/' + encodeURIComponent(claimToken) + '/claim', { method: 'POST', body: { mode } });
            bar.textContent = '';
            const done = document.createElement('b');
            done.textContent = 'It’s yours! 🎉 Find it in My Pages and redecorate away.';
            bar.appendChild(done);
          } catch (err) {
            btn.disabled = false;
            sub.textContent = err.message;
          }
        });
        return btn;
      };
      actions.append(mk('co-own it 🤝', 'co_own'), mk('take it over 🎨', 'take_over'));
    } else {
      const a = document.createElement('a');
      a.href = 'https://social-vibecoding.usernodelabs.org/#app/mypage-777ed2/full';
      a.textContent = 'open in Usernode to claim';
      actions.appendChild(a);
    }
    bar.appendChild(actions);
    return bar;
  }

  boot();
})();
