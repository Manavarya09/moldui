<div align="center">

# moldui

### Mold your UI like clay.

**The first visual editor that works on YOUR codebase, in ANY framework, powered by Claude.**

Drag · Resize · Edit text · Change styles — right in the browser. Claude writes the code.

[![npm](https://img.shields.io/npm/v/moldui?color=3b82f6&label=npm)](https://www.npmjs.com/package/moldui)
[![license](https://img.shields.io/npm/l/moldui?color=10b981)](./LICENSE)
[![downloads](https://img.shields.io/npm/dm/moldui?color=8b5cf6)](https://www.npmjs.com/package/moldui)
[![GitHub Stars](https://img.shields.io/github/stars/Manavarya09/moldui?style=social)](https://github.com/Manavarya09/moldui)

```bash
npx moldui
```

**That's it.** moldui auto-detects your dev server, injects a visual editor overlay, and turns your browser into Figma. Every change syncs to your source code via Claude.

</div>

---

## What is this?

You know that feeling when you see a button that needs more padding, or a heading that should be bigger, and you have to:

1. Open your IDE
2. Find the component
3. Hunt down the right CSS class
4. Tweak the value
5. Switch back to the browser
6. See it rendered
7. Tweak again

**moldui collapses that into one step.** Click the button in the browser. Drag a corner. Done. The code updates itself.

It's Figma-level spatial editing, but on your actual running app. In any framework. Any language. With Claude as the bridge.

## See it in action

> _Add GIF/video here — showing: click element → drag corner → see CSS update instantly → Save → Claude rewrites page.tsx → HMR refreshes browser_

## Install

```bash
# One-off (recommended)
npx moldui

# Or install globally
npm install -g moldui
moldui
```

**Zero config.** No package to add to your project. No framework plugin. No middleware. Works with what you already have running.

## How it works

```
┌──────────────┐       ┌─────────────────┐       ┌──────────────┐
│  Your browser│◄─────►│ moldui proxy    │◄─────►│  Your        │
│  + overlay   │       │ (injects editor)│       │  dev server  │
└──────────────┘       └─────────────────┘       └──────────────┘
       │                        │
       │ drag/resize/edit       │ batch pending changes
       ▼                        ▼
┌────────────────────────────────────────┐
│  .moldui/batch-{timestamp}.json        │
└────────────────────────────────────────┘
                 │
                 │ /moldui-sync in Claude Code
                 ▼
┌────────────────────────────────────────┐
│  Claude reads batch, rewrites source   │
│  files (page.tsx, styles.css, etc.)    │
└────────────────────────────────────────┘
```

1. **`npx moldui`** — starts a proxy on `:4444`, auto-opens your browser
2. **You edit visually** — drag, resize, double-click text, change colors
3. **Changes batch up** — the save button glows blue with a change count
4. **Click Save** — writes a batch file to `.moldui/`
5. **Run `/moldui-sync`** in Claude Code — Claude reads the batch and rewrites your source files
6. **HMR picks it up** — your dev server reloads with the real code changed

## What you can do

### Spatial editing (Figma-level)

- **Click** any element to select it
- **Drag** to reorder within or between containers
- **Resize** with 8 handles (corner + edge)
- **Double-click** text to edit inline
- **Shift+click** to multi-select and bulk-edit
- **Arrow keys** to nudge 1px (Shift+Arrow = 10px)
- **Right-click** for context menu (duplicate, wrap, copy styles, etc.)

### Visual style panel

A full properties panel for every element. Layout, spacing (with box-model visualization), typography, colors (with eyedropper + recent colors), borders, shadows, effects — all with live preview.

### Layers panel

A Figma-style tree of the DOM. Press `L`. Navigate, expand, select from the tree.

### Command palette

Press `Cmd+K` (or `Ctrl+K`) to fuzzy-search any element on the page by tag, class, id, or text content.

### AI chat

Press `Cmd+/` to open a chat panel. Ask things like "make this more modern" or "increase contrast" — your prompt + the selected element's context goes to Claude.

### Spacing guides

Hover while another element is selected → red guides show the exact pixel distance between them. Like Figma's measurement tool, but on your live app.

### Viewport frames

Top bar lets you switch to 375/768/1024/1280 with a device-style frame. Actually see what mobile looks like, not just guess.

### Zoom

`Cmd+scroll` to zoom in and out. `Cmd+0` to reset.

### Copy/paste styles

Right-click → Copy Styles → right-click another element → Paste Styles. Transfer the whole look.

### Image replacement

Select any `<img>` → Replace Image button appears → paste URL or upload. Change your hero image in 2 seconds.

### Undo/redo that actually reverts DOM

- `Cmd+Z` reverts the visual change instantly in the browser
- Floating Undo/Redo/Save buttons in the top-right
- Red badge shows pending change count
- Save writes to your real source code via Claude

### Keyboard shortcuts

| Key | Action |
|-----|--------|
| Click | Select |
| Shift+Click | Multi-select |
| Double-click | Edit text |
| Drag | Move/reorder |
| `S` | Style panel |
| `L` | Layers panel |
| `Cmd+K` | Search elements |
| `Cmd+/` | AI chat |
| `?` | Show all shortcuts |
| `Cmd+Z` / `Cmd+Shift+Z` | Undo / Redo |
| `Cmd+S` | Save to source |
| `Cmd+Scroll` / `Cmd+0` / `Cmd+=` / `Cmd+-` | Zoom |
| `Arrows` / `Shift+Arrows` | Nudge 1px / 10px |
| `Escape` | Deselect |
| `Delete` | Hide element |

## Supported frameworks

moldui works with **any** framework because it's a proxy, not a plugin. It's been tested with:

| Framework | Source mapping | Tailwind aware |
|-----------|:--------------:|:--------------:|
| Next.js (App Router) | ✅ | ✅ |
| Next.js (Pages Router) | ✅ | ✅ |
| Vite + React | ✅ | ✅ |
| Vite + Vue | ✅ | ✅ |
| Vite + Svelte | ✅ | ✅ |
| SvelteKit | ✅ | ✅ |
| Nuxt | ✅ | ✅ |
| Angular | ✅ | ✅ |
| Django | ✅ | ✅ |
| Rails | ✅ | ✅ |
| Laravel | ✅ | ✅ |
| Flask / FastAPI | ✅ | ✅ |
| Static HTML | ✅ | ✅ |

If your framework isn't listed, it probably still works — moldui falls back to grep-based source mapping.

## Compared to alternatives

| | **moldui** | Lovable | Webflow | v0 | Cursor |
|---|:---:|:---:|:---:|:---:|:---:|
| Works on existing codebases | ✅ | ❌ | ❌ | ❌ | ✅ |
| Any framework | ✅ | ❌ (React only) | ❌ (theirs) | ❌ (React/Next) | ✅ |
| Any language | ✅ | ❌ | ❌ | ❌ | ✅ |
| True drag & drop | ✅ | ❌ (properties only) | ✅ | ❌ | ❌ |
| Resize handles | ✅ | ❌ | ✅ | ❌ | ❌ |
| Zero config | ✅ | N/A (hosted) | N/A (hosted) | N/A (hosted) | ✅ |
| Open source | ✅ | ❌ | ❌ | ❌ | ❌ |
| Free forever | ✅ | 💰 | 💰 | 💰 | 💰 |

## Claude Code integration

If you use [Claude Code](https://claude.ai/code), install the plugin for tighter integration:

```
/plugin install moldui@Manavarya09/moldui
```

This gives you two slash commands:
- `/canvas` — starts moldui, ready to edit
- `/moldui-sync` — applies all pending visual edits to source code

Without Claude Code, moldui still works — you just run the CLI directly and any AI assistant that can read files can apply the batches.

## FAQ

**Does this work offline?** The editor itself, yes. The AI code-sync step requires Claude Code or another AI assistant.

**Can I edit production sites?** You can _inspect_ any site with moldui (point it at the URL). But code sync only works on your local codebase since Claude needs to edit your files.

**Does it touch my git history?** No. Moldui writes to `.moldui/` (already in `.gitignore`). Claude edits your source files — you commit when you're ready.

**Is it safe to run on any site?** The overlay only runs in your browser session. Nothing is sent anywhere except to `localhost`. No telemetry.

**How big is the overlay?** About 40KB of JS, 15KB of CSS. Loaded via `<script>` into your dev server, isolated in Shadow DOM so it doesn't pollute your page.

**What about my app's event handlers?** We intercept clicks for selection but don't interfere with your app's logic. Form submissions are prevented while the editor is active to avoid accidental data loss.

**Can I use it without Claude?** Yes — the editor works standalone. You just won't get the "AI rewrites your code" magic. Changes are saved to `.moldui/batch-*.json` and you can apply them manually.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Core principles:
- Editor stays vanilla JS (no framework deps)
- Shadow DOM only (no style leaks)
- Every change must be undoable
- Minimal diffs, match existing style

## Roadmap

- [x] v1.0 — drag, resize, text, styles, undo, save
- [x] v1.1 — cross-parent drag, spacing guides, arrow nudging
- [x] v1.2 — undo/redo/save action bar, visual undo
- [x] v2.0 — multi-select, layers panel, Cmd+K search, AI chat, viewport frames, zoom
- [ ] v2.1 — file watcher (detect external edits), session persistence
- [ ] v2.2 — collaborative editing (multiple browsers)
- [ ] v3.0 — AI-suggested component variants ("add a testimonials section")

## License

MIT © masyv

---

<div align="center">

**Built by [@masyv](https://github.com/Manavarya09) with Claude**

If moldui helps you ship faster, [star the repo](https://github.com/Manavarya09/moldui) — it really helps.

</div>
