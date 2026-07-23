// MPWidgets — widget-block rendering, shared by the editor preview and the
// public viewer. Same safety contract as the renderer: user strings only
// through textContent, URLs through PageRenderer.safeUrl, colors clamped.
(function () {
  'use strict';

  const R = () => window.PageRenderer;

  function card(labelText) {
    const el = document.createElement('div');
    el.className = 'mpw mpw-card';
    if (labelText) {
      const label = document.createElement('div');
      label.className = 'mpw-label';
      label.textContent = labelText;
      el.appendChild(label);
    }
    return el;
  }

  function timeAgo(iso) {
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return '';
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 90) return 'just now';
    if (s < 3600) return Math.round(s / 60) + 'm ago';
    if (s < 86400) return Math.round(s / 3600) + 'h ago';
    return Math.round(s / 86400) + 'd ago';
  }

  const RENDERERS = {
    mood(props) {
      const el = card('mood');
      const row = document.createElement('div');
      row.className = 'mpw-mood';
      const face = document.createElement('span');
      face.className = 'mpw-mood-face';
      face.textContent = typeof props.mood === 'string' ? props.mood.slice(0, 8) : '😌';
      const text = document.createElement('span');
      text.className = 'mpw-mood-text';
      text.textContent = typeof props.label === 'string' ? props.label.slice(0, 40) : '';
      row.append(face, text);
      el.appendChild(row);
      return el;
    },

    currently(props) {
      const el = card('currently');
      const items = Array.isArray(props.items) ? props.items.slice(0, 6) : [];
      items.forEach((it) => {
        if (!it || typeof it !== 'object') return;
        const row = document.createElement('div');
        row.className = 'mpw-currently-row';
        const verb = document.createElement('span');
        verb.className = 'mpw-currently-verb';
        verb.textContent = typeof it.verb === 'string' ? it.verb.slice(0, 24) : '';
        const what = document.createElement('span');
        what.textContent = typeof it.what === 'string' ? it.what.slice(0, 120) : '';
        row.append(verb, what);
        el.appendChild(row);
      });
      if (!items.length) {
        const hint = document.createElement('div');
        hint.className = 'mpw-gb-note';
        hint.textContent = 'reading · watching · playing…';
        el.appendChild(hint);
      }
      return el;
    },

    links(props, ctx) {
      const el = document.createElement('div');
      el.className = 'mpw mpw-links';
      const links = Array.isArray(props.links) ? props.links.slice(0, 8) : [];
      links.forEach((l) => {
        if (!l || typeof l !== 'object') return;
        const url = R().safeUrl(l.url);
        const a = document.createElement('a');
        a.className = 'mpw-link-btn';
        a.textContent = typeof l.label === 'string' && l.label.trim() ? l.label.slice(0, 60) : 'link';
        if (url && !(ctx && ctx.editing)) {
          a.href = url;
          a.target = '_blank';
          a.rel = 'noopener nofollow';
        } else {
          a.href = '#';
          a.addEventListener('click', (e) => e.preventDefault());
        }
        el.appendChild(a);
      });
      if (!links.length) {
        const empty = card();
        empty.textContent = '🔗 link buttons';
        return empty;
      }
      return el;
    },

    marquee(props) {
      const el = document.createElement('div');
      el.className = 'mpw mpw-marquee';
      const span = document.createElement('span');
      span.textContent = typeof props.text === 'string' ? props.text.slice(0, 300) : 'marquee text drifting by…';
      span.style.animationDuration = R().clamp(props.speed, 3, 40, 12) + 's';
      span.style.color = R().safeColor(props.color, '#1F2B47');
      span.style.fontSize = R().clamp(props.size, 10, 60, 18) + 'px';
      el.appendChild(span);
      return el;
    },

    counter(props, ctx) {
      const el = document.createElement('div');
      const styleKey = ['classic', 'pink', 'terminal'].includes(props.style) ? props.style : 'classic';
      el.className = 'mpw mpw-counter' + (styleKey !== 'classic' ? ' mpw-counter-' + styleKey : '');
      const digits = document.createElement('div');
      digits.className = 'mpw-counter-digits';
      const total = Number.isFinite(Number(ctx && ctx.visits)) ? Number(ctx.visits) : 0;
      String(total).padStart(4, '0').split('').forEach((d) => {
        const b = document.createElement('b');
        b.textContent = d;
        digits.appendChild(b);
      });
      const cap = document.createElement('div');
      cap.className = 'mpw-counter-caption';
      cap.textContent = 'visitors';
      el.append(digits, cap);
      return el;
    },

    song(props, ctx) {
      const el = card('now playing — on repeat');
      const row = document.createElement('div');
      row.className = 'mpw-song';
      const song = ctx && ctx.song;
      const disc = document.createElement('div');
      disc.className = 'mpw-song-disc';
      disc.textContent = '♪';
      const meta = document.createElement('div');
      const title = document.createElement('div');
      title.className = 'mpw-song-title';
      title.textContent = song && typeof song.title === 'string' && song.title.trim() ? song.title.slice(0, 90) : 'no song yet';
      meta.appendChild(title);
      if (song && typeof song.artist === 'string' && song.artist.trim()) {
        const artist = document.createElement('div');
        artist.className = 'mpw-song-artist';
        artist.textContent = song.artist.slice(0, 90);
        meta.appendChild(artist);
      }
      const actions = document.createElement('div');
      actions.className = 'mpw-song-actions';
      if (song && window.MPSong) {
        const srcUrl = window.MPSong.sourceUrl(song, ctx && ctx.music);
        if (srcUrl) {
          const play = document.createElement('button');
          play.className = 'mpw-song-play';
          play.textContent = '▶';
          play.setAttribute('aria-label', 'Play song');
          if (ctx && ctx.editing) {
            play.addEventListener('click', (e) => e.preventDefault());
          } else {
            play.addEventListener('click', () => window.MPSong.toggle(srcUrl, play, disc));
          }
          actions.appendChild(play);
        }
        const out = window.MPSong.linkOut(song);
        if (out) actions.appendChild(out);
      }
      row.append(disc, meta, actions);
      el.appendChild(row);
      return el;
    },

    guestbook(props, ctx) {
      const el = card('guestbook');
      el.classList.add('mpw-guestbook');
      const gb = ctx && ctx.guestbook;
      if (!gb) {
        const hint = document.createElement('div');
        hint.className = 'mpw-gb-note';
        hint.textContent = '📖 visitors sign here — you approve anonymous notes before they show.';
        el.appendChild(hint);
        return el;
      }
      (gb.entries || []).slice(0, 30).forEach((entry) => {
        const row = document.createElement('div');
        row.className = 'mpw-gb-entry';
        const name = document.createElement('span');
        name.className = 'mpw-gb-name';
        name.textContent = entry.author_name;
        const time = document.createElement('span');
        time.className = 'mpw-gb-time';
        time.textContent = timeAgo(entry.created_at);
        const body = document.createElement('div');
        body.textContent = entry.body;
        row.append(name, time);
        if (gb.onReportEntry) {
          const rep = document.createElement('button');
          rep.className = 'mpw-gb-report';
          rep.textContent = 'report';
          rep.addEventListener('click', () => gb.onReportEntry(entry));
          row.appendChild(rep);
        }
        row.appendChild(body);
        el.appendChild(row);
      });
      if (!(gb.entries || []).length) {
        const none = document.createElement('div');
        none.className = 'mpw-gb-note';
        none.textContent = 'no signs yet — be the first';
        el.appendChild(none);
      }
      if (gb.closed) {
        const closed = document.createElement('div');
        closed.className = 'mpw-gb-note';
        closed.style.marginTop = '8px';
        closed.textContent = '📕 the book is closed';
        el.appendChild(closed);
      } else if (gb.onSign) {
        el.appendChild(buildSignForm(gb));
      }
      return el;
    },
  };

  function buildSignForm(gb) {
    const form = document.createElement('form');
    form.className = 'mpw-gb-form';
    let nameInput = null;
    if (!gb.signedInAs) {
      nameInput = document.createElement('input');
      nameInput.placeholder = 'your name';
      nameInput.maxLength = 80;
      form.appendChild(nameInput);
    }
    // honeypot — hidden from humans, tempting to bots
    const hp = document.createElement('input');
    hp.className = 'mpw-gb-hp';
    hp.name = 'website';
    hp.tabIndex = -1;
    hp.autocomplete = 'off';
    form.appendChild(hp);
    const body = document.createElement('textarea');
    body.placeholder = 'leave a little note…';
    body.maxLength = 280;
    form.appendChild(body);
    const note = document.createElement('div');
    note.className = 'mpw-gb-note';
    note.textContent = gb.signedInAs
      ? 'signing as ' + gb.signedInAs
      : 'anonymous signs wait for the owner’s approval';
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'mpw-gb-submit';
    submit.textContent = 'sign it';
    form.append(note, submit);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      submit.disabled = true;
      try {
        await gb.onSign({
          name: nameInput ? nameInput.value : '',
          body: body.value,
          website: hp.value,
        });
        body.value = '';
        if (nameInput) nameInput.value = '';
        note.textContent = gb.signedInAs ? 'signed ✓' : 'sent — it’ll show once the owner approves ✓';
      } catch (err) {
        note.textContent = err.message;
      } finally {
        submit.disabled = false;
      }
    });
    return form;
  }

  function render(props, ctx) {
    const kind = props && props.kind;
    const fn = RENDERERS[kind];
    if (!fn) {
      const el = card();
      el.textContent = 'unknown widget';
      return el;
    }
    return fn(props || {}, ctx || {});
  }

  window.MPWidgets = { render };
})();
