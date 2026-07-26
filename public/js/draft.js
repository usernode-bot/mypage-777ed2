// MPDraft — the account-less editor's local draft (spec §6.7 rung 4).
// An anonymous visitor decorates a full page in /make; the draft lives in
// localStorage on the app origin, which the iframe-embedded app shares —
// so it survives sign-up and imports on the next authenticated load.
(function () {
  'use strict';

  const KEY = 'mp_local_draft_v1';

  // An in-memory draft that shadows localStorage without writing to it —
  // used by the /make?shot=editor screenshot deep link so opening the
  // editor from a link never plants a phantom draft on someone's device.
  let ephemeral = null;

  function setEphemeral(draft) {
    ephemeral = draft && draft.content ? draft : null;
  }

  function load() {
    if (ephemeral) return ephemeral;
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const draft = JSON.parse(raw);
      if (!draft || typeof draft !== 'object' || !draft.content) return null;
      return draft;
    } catch { return null; }
  }

  function save(draft) {
    // A real edit graduates an ephemeral draft into a persisted one.
    ephemeral = null;
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
    ephemeral = null;
    try { localStorage.removeItem(KEY); } catch {}
  }

  window.MPDraft = { load, save, clear, setEphemeral };
})();
