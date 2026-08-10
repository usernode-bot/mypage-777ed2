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

  // Optional per-widget card label override ("fan club notes" instead of
  // "guestbook"). User string — textContent only, sliced.
  function cardTitle(props, fallback) {
    return (typeof props.title === 'string' && props.title.trim())
      ? props.title.trim().slice(0, 60)
      : fallback;
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
      const el = card(cardTitle(props, 'now playing — on repeat'));
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

    status(props) {
      const el = card(cardTitle(props, 'status'));
      const row = document.createElement('div');
      row.className = 'mpw-status-row';
      if (typeof props.emoji === 'string' && props.emoji.trim()) {
        const em = document.createElement('span');
        em.className = 'mpw-status-emoji';
        em.textContent = [...props.emoji.trim()].slice(0, 4).join('');
        row.appendChild(em);
      }
      const body = document.createElement('div');
      const text = document.createElement('div');
      text.className = 'mpw-status-text';
      text.textContent = typeof props.text === 'string' && props.text.trim()
        ? props.text.slice(0, 280) : 'no status yet';
      body.appendChild(text);
      const when = new Date(props.updatedAt || NaN).getTime();
      if (Number.isFinite(when)) {
        const time = document.createElement('div');
        time.className = 'mpw-status-time';
        time.textContent = 'updated ' + timeAgo(new Date(when).toISOString());
        body.appendChild(time);
      }
      row.appendChild(body);
      el.appendChild(row);
      return el;
    },

    quote(props) {
      const el = card(cardTitle(props, 'quote'));
      const q = document.createElement('div');
      q.className = 'mpw-quote-text';
      q.textContent = typeof props.text === 'string' && props.text.trim()
        ? props.text.slice(0, 600) : '“…”';
      el.appendChild(q);
      if (typeof props.attribution === 'string' && props.attribution.trim()) {
        const a = document.createElement('div');
        a.className = 'mpw-quote-attr';
        a.textContent = '— ' + props.attribution.slice(0, 80);
        el.appendChild(a);
      }
      return el;
    },

    list(props) {
      const el = card(cardTitle(props, 'list'));
      const items = Array.isArray(props.items) ? props.items.slice(0, 10) : [];
      items.forEach((it) => {
        if (!it || typeof it !== 'object') return;
        const row = document.createElement('div');
        row.className = 'mpw-list-row';
        const label = document.createElement('span');
        label.textContent = typeof it.label === 'string' ? it.label.slice(0, 80) : '';
        row.appendChild(label);
        if (typeof it.value === 'string' && it.value.trim()) {
          const val = document.createElement('span');
          val.className = 'mpw-list-val';
          val.textContent = it.value.slice(0, 40);
          row.appendChild(val);
        }
        el.appendChild(row);
      });
      if (!items.length) {
        const hint = document.createElement('div');
        hint.className = 'mpw-gb-note';
        hint.textContent = 'a titled list — movies, nicknames, routines…';
        el.appendChild(hint);
      }
      return el;
    },

    playlist(props, ctx) {
      const el = card(cardTitle(props, 'playlist'));
      const tracks = Array.isArray(props.tracks) ? props.tracks.slice(0, 8) : [];
      tracks.forEach((t, i) => {
        if (!t || typeof t !== 'object') return;
        const row = document.createElement('div');
        row.className = 'mpw-pl-row';
        const num = document.createElement('span');
        num.className = 'mpw-pl-num';
        num.textContent = String(i + 1).padStart(2, '0');
        const meta = document.createElement('div');
        const title = document.createElement('div');
        title.className = 'mpw-pl-title';
        title.textContent = typeof t.title === 'string' ? t.title.slice(0, 90) : '';
        meta.appendChild(title);
        if (typeof t.artist === 'string' && t.artist.trim()) {
          const artist = document.createElement('div');
          artist.className = 'mpw-pl-artist';
          artist.textContent = t.artist.slice(0, 90);
          meta.appendChild(artist);
        }
        row.append(num, meta);
        const url = R().safeUrl(t.url);
        if (url && !(ctx && ctx.editing)) {
          const out = document.createElement('a');
          out.className = 'mpw-pl-out';
          out.textContent = '↗';
          out.href = url;
          out.target = '_blank';
          out.rel = 'noopener nofollow';
          out.setAttribute('aria-label', 'Open track');
          row.appendChild(out);
        }
        el.appendChild(row);
      });
      if (!tracks.length) {
        const hint = document.createElement('div');
        hint.className = 'mpw-gb-note';
        hint.textContent = 'a little tracklist, like the back of a burned CD';
        el.appendChild(hint);
      }
      return el;
    },

    album(props) {
      const el = card(cardTitle(props, 'photo album'));
      const grid = document.createElement('div');
      grid.className = props.layout === 'grid' ? 'mpw-album-grid' : 'mpw-album-strip';
      const photos = Array.isArray(props.photos)
        ? props.photos.filter((id) => Number.isInteger(id)).slice(0, 6) : [];
      const slots = Math.max(photos.length, props.layout === 'grid' ? 4 : 3);
      for (let i = 0; i < slots; i++) {
        const cell = document.createElement('div');
        cell.className = 'mpw-album-cell';
        if (i < photos.length) {
          const img = document.createElement('img');
          img.src = '/assets/' + photos[i]; // only ever our own asset route
          img.alt = '';
          img.loading = 'lazy';
          img.draggable = false;
          cell.appendChild(img);
        } else {
          cell.classList.add('mpw-album-empty');
          cell.textContent = '✦';
        }
        grid.appendChild(cell);
      }
      el.appendChild(grid);
      return el;
    },

    popup(props, ctx) {
      const el = document.createElement('div');
      el.className = 'mpw mpw-popup';
      const title = document.createElement('div');
      title.className = 'mpw-popup-title';
      const icon = document.createElement('span');
      icon.className = 'mpw-popup-icon';
      icon.textContent = '♡';
      const titleText = document.createElement('span');
      titleText.textContent = typeof props.title === 'string' && props.title.trim()
        ? props.title.slice(0, 120) : 'Are you sure you want to leave?';
      title.append(icon, titleText);
      const body = document.createElement('div');
      body.className = 'mpw-popup-body';
      body.textContent = typeof props.body === 'string' ? props.body.slice(0, 400) : '';
      const acts = document.createElement('div');
      acts.className = 'mpw-popup-acts';
      const stay = document.createElement('button');
      stay.className = 'mpw-popup-stay';
      stay.textContent = typeof props.stayLabel === 'string' && props.stayLabel.trim()
        ? props.stayLabel.slice(0, 40) : 'stay a while ♡';
      const bye = document.createElement('button');
      bye.className = 'mpw-popup-bye';
      bye.textContent = typeof props.byeLabel === 'string' && props.byeLabel.trim()
        ? props.byeLabel.slice(0, 40) : 'ok bye :(';
      const editing = !!(ctx && ctx.editing);
      stay.addEventListener('click', (e) => {
        e.preventDefault();
        if (editing) return;
        el.classList.remove('mpw-popup-pulse');
        void el.offsetWidth; // restart the little thank-you pulse
        el.classList.add('mpw-popup-pulse');
      });
      bye.addEventListener('click', (e) => {
        e.preventDefault();
        if (editing) return;
        const blockEl = el.closest('.mp-block');
        if (blockEl) {
          try { sessionStorage.setItem('mp_popup_' + (blockEl.dataset.blockId || ''), '1'); } catch {}
          blockEl.style.display = 'none';
        }
      });
      acts.append(stay, bye);
      el.append(title, body, acts);
      if (!editing) {
        // If this visitor already said bye this session, keep it hidden.
        requestAnimationFrame(() => {
          const blockEl = el.closest('.mp-block');
          if (!blockEl) return;
          try {
            if (sessionStorage.getItem('mp_popup_' + (blockEl.dataset.blockId || ''))) {
              blockEl.style.display = 'none';
            }
          } catch {}
        });
      }
      return el;
    },

    guestbook(props, ctx) {
      const el = card(cardTitle(props, 'guestbook'));
      el.classList.add('mpw-guestbook');
      const gb = ctx && ctx.guestbook;
      if (!gb) {
        const hint = document.createElement('div');
        hint.className = 'mpw-gb-note';
        hint.textContent = '📖 visitors sign here — you approve anonymous notes before they show.';
        el.appendChild(hint);
        return el;
      }
      const entriesBox = document.createElement('div');
      el.appendChild(entriesBox);

      function entryRow(entry, pending) {
        const row = document.createElement('div');
        row.className = 'mpw-gb-entry' + (pending ? ' mpw-gb-entry-pending' : '');
        const name = document.createElement('span');
        name.className = 'mpw-gb-name';
        name.textContent = entry.author_name;
        const time = document.createElement('span');
        time.className = 'mpw-gb-time';
        time.textContent = timeAgo(entry.created_at);
        const body = document.createElement('div');
        body.textContent = entry.body;
        row.append(name, time);
        if (pending) {
          const wait = document.createElement('span');
          wait.className = 'mpw-gb-wait';
          wait.textContent = 'awaiting approval';
          row.appendChild(wait);
        } else if (gb.onReportEntry) {
          const rep = document.createElement('button');
          rep.className = 'mpw-gb-report';
          rep.textContent = 'report';
          rep.addEventListener('click', () => gb.onReportEntry(entry));
          row.appendChild(rep);
        }
        row.appendChild(body);
        return row;
      }

      (gb.entries || []).slice(0, 30).forEach((entry) => entriesBox.appendChild(entryRow(entry)));
      let emptyNote = null;
      if (!(gb.entries || []).length) {
        emptyNote = document.createElement('div');
        emptyNote.className = 'mpw-gb-note';
        emptyNote.textContent = 'no signs yet — be the first';
        entriesBox.appendChild(emptyNote);
      }
      function prependEntry(entry, pending) {
        if (emptyNote) { emptyNote.remove(); emptyNote = null; }
        entriesBox.prepend(entryRow(entry, pending));
      }
      if (gb.closed) {
        const closed = document.createElement('div');
        closed.className = 'mpw-gb-note';
        closed.style.marginTop = '8px';
        closed.textContent = '📕 the book is closed';
        el.appendChild(closed);
      } else if (gb.onSign) {
        el.appendChild(buildSignForm(gb, prependEntry));
      }
      return el;
    },
  };

  function buildSignForm(gb, onSigned) {
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
      submit.textContent = 'signing…';
      const signedName = (gb.signedInAs || (nameInput ? nameInput.value.trim() : '') || 'you').slice(0, 80);
      const signedBody = body.value;
      try {
        const res = await gb.onSign({
          name: nameInput ? nameInput.value : '',
          body: body.value,
          website: hp.value,
        });
        body.value = '';
        if (nameInput) nameInput.value = '';
        const entry = res && res.entry;
        if (entry && entry.status === 'approved') {
          gb.entries = gb.entries || [];
          gb.entries.unshift(entry);
          if (onSigned) onSigned(entry, false);
          note.textContent = 'signed ✓';
        } else {
          // Anonymous sign: show a client-side placeholder so the visitor
          // sees their note landed; it goes public once the owner approves.
          if (onSigned) onSigned({ author_name: signedName, body: signedBody, created_at: new Date().toISOString() }, true);
          note.textContent = 'sent — it’ll show once the owner approves ✓';
        }
      } catch (err) {
        note.textContent = err.message;
      } finally {
        submit.disabled = false;
        submit.textContent = 'sign it';
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
