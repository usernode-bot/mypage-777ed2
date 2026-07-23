// MPSong — the "now playing, on repeat" audio: looping playback for safe
// sources only (the app's committed royalty-free library + the owner's own
// uploaded original audio), and link-out detection for Spotify/Apple/
// YouTube. No cover-art scraping, no unlicensed playback — the named-and-
// linked song carries the identity even silent.
(function () {
  'use strict';

  let audio = null;
  let currentUrl = null;
  let currentBtn = null;
  let currentDisc = null;

  function musicMapFrom(list) {
    const map = {};
    (list || []).forEach((m) => { map[m.key] = m.file_path; });
    return map;
  }
  let libraryMap = {};
  function setCatalog(catalog) {
    libraryMap = musicMapFrom(catalog && catalog.music);
  }

  // Resolves a song's playable URL. Only two shapes are honored:
  //   library:<key>  → the committed library file (whitelist lookup)
  //   upload:<id>    → /assets/<int> (our own asset route)
  function sourceUrl(song, musicList) {
    if (!song || typeof song.source !== 'string') return null;
    if (song.source.startsWith('library:')) {
      const key = song.source.slice(8);
      const map = musicList ? musicMapFrom(musicList) : libraryMap;
      return map[key] || null;
    }
    if (song.source.startsWith('upload:')) {
      const id = parseInt(song.source.slice(7), 10);
      return Number.isInteger(id) && id > 0 ? '/assets/' + id : null;
    }
    return null;
  }

  function stop() {
    if (audio) { audio.pause(); audio = null; }
    if (currentBtn) currentBtn.textContent = '▶';
    if (currentDisc) currentDisc.classList.remove('mpw-spinning');
    currentUrl = null; currentBtn = null; currentDisc = null;
  }

  // Play/pause toggle — always user-initiated (autoplay policies require a
  // tap anyway, and a page that autoplays at you is rude).
  function toggle(url, btn, disc) {
    if (currentUrl === url && audio && !audio.paused) { stop(); return; }
    stop();
    audio = new Audio(url);
    audio.loop = true; // on repeat — the whole point
    audio.volume = 0.85;
    currentUrl = url; currentBtn = btn; currentDisc = disc;
    audio.play().then(() => {
      if (btn) btn.textContent = '❚❚';
      if (disc) disc.classList.add('mpw-spinning');
    }).catch(() => stop());
  }

  // "listen ↗" link-out with service detection. URL is safeUrl-validated.
  function linkOut(song) {
    const url = song && window.PageRenderer ? window.PageRenderer.safeUrl(song.linkUrl) : null;
    if (!url) return null;
    let label = 'listen ↗';
    try {
      const host = new URL(url).hostname.replace(/^www\./, '');
      if (host.includes('spotify')) label = 'Spotify ↗';
      else if (host.includes('music.apple') || host.includes('apple.com')) label = 'Apple Music ↗';
      else if (host.includes('youtu')) label = 'YouTube ↗';
      else if (host.includes('bandcamp')) label = 'Bandcamp ↗';
      else if (host.includes('soundcloud')) label = 'SoundCloud ↗';
    } catch {}
    const a = document.createElement('a');
    a.className = 'mpw-song-out';
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener nofollow';
    a.textContent = label;
    return a;
  }

  window.MPSong = { sourceUrl, toggle, stop, linkOut, setCatalog };
})();
