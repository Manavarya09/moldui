<div align="center">

# moldui

### The first visual editor for your **actual codebase**.

Drag. Resize. Edit text. Swap layouts. In the browser.  
Claude writes the code.

[![npm](https://img.shields.io/npm/v/moldui?color=22d3ee&label=npm&style=flat-square)](https://www.npmjs.com/package/moldui)
[![downloads](https://img.shields.io/npm/dm/moldui?color=60a5fa&style=flat-square)](https://www.npmjs.com/package/moldui)
[![license](https://img.shields.io/npm/l/moldui?color=34d399&style=flat-square)](./LICENSE)
[![stars](https://img.shields.io/github/stars/Manavarya09/moldui?style=flat-square&color=f59e0b)](https://github.com/Manavarya09/moldui)

```bash
npx moldui
```

**Zero config.** Auto-detects your dev server. Opens your browser. Injects a Figma-like editor. Every visual change becomes a real commit in your real code.

</div>

---

## 60 seconds

> _▶ 60-second demo GIF here — click → drag → resize → type → Save → Claude writes it to `page.tsx`_

## Why this changes things

Every web dev has had this moment:

> "This button needs 8 more pixels of padding."

Then you:
1. Open IDE
2. Find the component
3. Hunt the class
4. Change the number
5. Switch to browser
6. Squint
7. Repeat

**moldui collapses that to one step.** Grab the button. Drag the corner. Done. HMR reloads with real source changes Claude wrote for you.

No plugin to install in your project. No framework lock-in. Works with **Next.js, Vite, Vue, Svelte, Django, Rails, Laravel, Flask, plain HTML** — anything that serves HTML.

## Install & run

```bash
# 1. Start your dev server (any framework)
npm run dev

# 2. In another terminal
npx moldui
```

Browser opens with your app + the editor overlay. That's the entire setup.

## What you can do

### Spatial editing (Figma-grade)
- **Click** to select · **Shift-click** for multi-select
- **Drag** to reorder · **Alt-drag** to **swap** two elements
- **Resize handles** on 8 sides · **Arrow keys** to nudge 1px (Shift+Arrow = 10px)
- **Double-click** text to edit inline · **Delete** to hide

### Live style editor
Full properties panel: layout, **one-click spacing presets (4/8/16/24px)**, typography, colors with **eyedropper + recent colors**, borders, shadows, effects. All live-preview, all undo-able.

### AI ✨
- **Apply with Claude** — after Save, Claude runs headlessly and writes the code changes
- **Live progress** — watch files update as Claude edits them: *"Editing src/app/page.tsx..."*
- **✨ AI Suggest** — click on any element, get 2-3 design variations from Claude
- **Auto commit messages** — suggested `git commit -m` after apply

### Power tools
- **Layers panel** (`L`) — Figma-style DOM tree
- **Cmd+K palette** — fuzzy-search any element on the page
- **Right-click menu** — Duplicate · Wrap · Copy/Paste styles · Copy HTML/CSS · **Lock** · Delete
- **Viewport frames** — preview 375 / 768 / 1024 / 1280 with device chrome
- **Zoom** — `Cmd+Scroll` like Figma canvas
- **Spacing guides** — hover while selected, see exact pixel distances between elements
- **Lock elements** — right-click → Lock to click-through during editing

### Keyboard
Press `?` for the complete cheatsheet. All shortcuts use a single modifier at most.

## How it works

```
┌──────────────┐  WebSocket   ┌──────────────┐  spawn('claude') ┌────────────────┐
│ Browser      │ ───────────► │ moldui proxy │ ───────────────► │ Claude Code    │
│ (editor)     │              │ (Node.js)    │   headless       │ (reads batch,  │
└──────────────┘              └──────────────┘                  │  edits source) │
       ▲                             │                          └────────────────┘
       │                             ▼                                   │
       │                      .moldui/batch.json                         │
       │                                                                 │
       └─── stream-json events ──────────────────────────────────────────┘
           (Reading, Editing, Done)
```

1. **Proxy injects editor** into your dev server's HTML responses
2. **You edit visually** — changes apply instantly as CSS overrides
3. **Click Save** — batch written to `.moldui/batch-{ts}.json`
4. **Claude runs headlessly** — reads batch, rewrites your real source
5. **Your HMR kicks in** — browser reloads with real code changes

## vs the alternatives

| | **moldui** | Lovable | Webflow | v0 | Anthropic Preview |
|---|:---:|:---:|:---:|:---:|:---:|
| Works on **your existing codebase** | ✅ | ❌ | ❌ | ❌ | ✅ |
| **Any framework / any language** | ✅ | ❌ (React only) | ❌ | ❌ | ✅ |
| **True drag & drop** | ✅ | ❌ (properties) | ✅ | ❌ | ❌ |
| **Resize handles** | ✅ | ❌ | ✅ | ❌ | ❌ |
| **Swap two elements (Alt-drag)** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Zero config / any browser** | ✅ | N/A | N/A | N/A | ❌ (desktop app) |
| **Cross-AI** (Claude / Cursor / Gemini) | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Open source** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Free** | ✅ | 💰 | 💰 | 💰 | 💰 |

## Works with

Ship-tested on: **Next.js** (App + Pages Router), **Vite** (React/Vue/Svelte), **SvelteKit**, **Nuxt**, **Angular**, **Django**, **Rails**, **Laravel**, **Flask**, **FastAPI**, **plain HTML**.

Cross-AI: **Claude Code** (auto-apply), **Cursor**, **Gemini CLI**, **GitHub Copilot**, **Windsurf**, **Aider**, **Cline** (all use the `.moldui/` batch format).

## Claude Code users

Install the plugin for headless auto-apply:

```bash
claude plugin install Manavarya09/moldui
```

Then `npx moldui` auto-detects Claude and runs `/moldui-sync` for you when you click Save. Zero terminal switches.

## Keyboard quick reference

| | |
|---|---|
| `S` | Style panel |
| `L` | Layers panel |
| `W` | Welcome card |
| `?` | All shortcuts |
| `Cmd+K` | Find element |
| `Cmd+/` | AI chat |
| `Cmd+S` | Save to source |
| `Cmd+Z` / `Cmd+Shift+Z` | Undo / Redo |
| `Cmd+Enter` | Apply pending changes |
| `Alt+Drag` | Swap two elements |
| `Arrows` / `Shift+Arrows` | Nudge 1px / 10px |

## Roadmap

- [x] v1 — drag, resize, text, styles, undo, save
- [x] v2.0 — multi-select, layers, palette, AI chat, viewport frames
- [x] v2.2 — glassmorphism theme, token optimization, empty states
- [x] v2.3 — headless auto-sync, apply panel, ✨ AI Suggest, Alt-drag swap
- [x] v2.4 — spacing presets, element lock, commit msg generator, all-blue theme
- [ ] v3.0 — collaborative editing (multiplayer), Figma two-way sync

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Core rules: vanilla JS in `src/inject/`, Shadow DOM only, every change undoable.

## License

MIT © masyv · [GitHub](https://github.com/Manavarya09/moldui) · [npm](https://www.npmjs.com/package/moldui)

---

<div align="center">

**If moldui shipped a feature you wished existed — [star the repo](https://github.com/Manavarya09/moldui). It genuinely helps.**

</div>
