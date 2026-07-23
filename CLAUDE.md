# MyPage — notes for Claude Code

This app runs on **Usernode Social Vibecoding**. If you're Claude Code
editing this repo, read the platform conventions before making
changes:

**Platform conventions (authoritative, always current):**
https://social-vibecoding.usernodelabs.org/claude.md

Fetch that URL at the start of each session — it's the single source
of truth for platform-wide behavior (auth model, `USERNODE_ENV`,
public/private tables, "don't `git push`", etc.). The hosted copy is
updated in place when platform rules change, so fetching it gives you
today's rules, not a stale snapshot.

When running inside Usernode's dev-chat, those same conventions are
already injected into your system prompt, so the fetch is a no-op in
that path — but it's the right reflex when someone runs Claude Code
against this repo locally or from another harness.

If a rule below this line conflicts with the hosted conventions, the
hosted conventions win. This file is **app-specific** — write down
things about *this* app that belong in the repo: product intent,
data-model quirks, style preferences, opt-in policies (e.g. which
tables you've marked private), etc.

---

## About MyPage

MyPage & FanPages — "a personality as a page." A decorating tool for
making small, loud personal web pages (for yourself, a friend, your
pet, your OC, or a comfort character). Editor-first, not
network-first: no feed, no followers, no likes, no DMs, no trending —
the only metric anywhere is the retro visit counter. The build follows
the phased plan in the session spec (editor → public account-less
viewing → decoration → song → guestbook → gifts → directory/templates).

## App-specific conventions

- **Page documents** live in `pages.content` (jsonb). One shape shared
  by the editor and every viewer: page-level `{ cursor, song,
  footerStyle }` + `sections: [{ id, background, minHeight, blocks }]`;
  blocks are `{ id, type, x (%), y (px), w (%), rotation, z, props }`.
  All rendering goes through `public/js/renderer.js` — never render a
  page document any other way, and never `innerHTML` user strings from
  it (public pages make this the app's XSS surface).
- **Private tables** (`staging:private`): `gift_claims` (bearer claim
  tokens) and `reports` (reporter identity). Everything else is public
  by design — pages are the platform's most public artifact.
- The `presses` table is a leftover from the starter template demo; the
  code no longer creates or uses it. Don't resurrect it.
- Reserved page handles (slugs) are listed in `RESERVED_SLUGS` in
  `server.js` — extend it whenever a new top-level route is added.
- No engagement mechanics, ever: no points for pages/views/signs, no
  like buttons, no follower counts. The absence is the feature.
