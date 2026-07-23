// MPDraft — the account-less editor's local draft (spec §6.7 rung 4).
// An anonymous visitor decorates a full page in /make; the draft lives in
// localStorage on the app origin, which the iframe-embedded app shares —
// so it survives sign-up and imports on the next authenticated load.
(function () {
  'use strict';

  const KEY = 'mp_local_draft_v1';

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const draft = JSON.parse(raw);
      if (!draft || typeof draft !== 'object' || !draft.content) return null;
      return draft;
    } catch { return null; }
  }

  function save(draft) {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        title: draft.title,
        subject_type: draft.subject_type,
        subject_name: draft.subject_name || null,
        content: draft.content,
        savedAt: Date.now(),
      }));
      return true;
    } catch { return false; }
  }

  function clear() {
    try { localStorage.removeItem(KEY); } catch {}
  }

  window.MPDraft = { load, save, clear };
})();
