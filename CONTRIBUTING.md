# Contributing to moldui

Thanks for your interest in making moldui better. This doc covers how to set up, what we're looking for, and how to ship a change.

## Quick setup

```bash
git clone https://github.com/Manavarya09/moldui.git
cd moldui
npm install
```

Run against any dev server to test:

```bash
# start any dev server in another terminal, e.g. npm run dev on :3000
node bin/moldui.js 3000
```

## Project layout

```
moldui/
├── bin/moldui.js           # CLI entry point
├── src/
│   ├── proxy.js            # HTTP proxy + script injection
│   ├── websocket.js        # WebSocket hub (browser ↔ Claude Code)
│   ├── detector.js         # Auto-detect dev server + framework
│   ├── mapper.js           # DOM element → source file mapping
│   ├── differ.js           # Change descriptors → sync prompt
│   ├── undo.js             # Undo/redo stack (server-side)
│   └── inject/
│       ├── editor.js       # The whole in-browser editor overlay (IIFE)
│       └── editor.css      # Overlay styles (dark theme, Shadow DOM)
├── skills/
│   ├── canvas/SKILL.md     # /canvas slash command
│   └── moldui-sync/SKILL.md # /moldui-sync slash command
└── .claude-plugin/
    ├── plugin.json         # Claude Code plugin manifest
    └── marketplace.json
```

## What we want

**Great fits:**
- New editor capabilities (alignment tools, guides, snap, keyboard nav)
- Framework-specific source-mapping improvements (especially for Vue/Svelte/Angular)
- Better Tailwind class inference in `differ.js`
- Accessibility improvements to the overlay itself
- Bug fixes with minimal repro cases

**Not a fit:**
- Major architectural rewrites without discussion first
- Adding heavy dependencies to the injected editor (it should stay ~50KB)
- Breaking changes without strong justification

## Ground rules

1. **Keep the editor vanilla JS.** No React/Vue/framework dependencies in `src/inject/`. Must work on any page.
2. **Shadow DOM everything.** Editor UI must not leak styles into the user's page.
3. **DOM methods only.** No `innerHTML` with user-controlled content.
4. **Changes must be undoable.** Every new edit type needs a revert function passed to `sendChangeWithUndo`.
5. **Respect the existing style.** Read neighboring code and match it.

## Making a change

1. Fork & branch: `git checkout -b fix/short-description`
2. Make minimal changes
3. Test against at least one real dev server (Next.js, Vite, static HTML all work)
4. Run `node -c src/inject/editor.js` to verify syntax
5. Commit with a descriptive message
6. Open a PR with:
   - What changed
   - Why
   - How you tested (steps + framework used)
   - Before/after GIF for visual changes

## Testing a new edit type

If you're adding a new change type (beyond `style`, `text`, `reorder`, `clone`, `delete`, `wrap`, `image`, `chat`):

1. Define the change descriptor shape in `src/differ.js` (add a new case in `buildSyncPrompt`)
2. Call `sendChangeWithUndo(change, revertFn, applyFn)` from the editor
3. Update `skills/moldui-sync/SKILL.md` with instructions for Claude to handle the new type
4. Add an entry to the README features table

## Releasing

Maintainers only. Bump `package.json` version, `bin/moldui.js` version string, commit, tag, push, `npm publish`.

## Questions?

Open an issue or discussion. We read everything.
