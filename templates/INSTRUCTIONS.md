# moldui — Instructions for AI Assistants

This project uses [moldui](https://github.com/Manavarya09/moldui) for visual editing. When the user asks you to "sync moldui changes", "apply visual edits", "apply moldui", or similar, follow these steps.

## What to do

1. **Check for pending batches** in `.moldui/`:
   ```
   ls .moldui/batch-*.json
   ```
   If none exist, tell the user: "No pending moldui edits. Run `npx moldui` and make some visual changes first."

2. **For each batch file** (process oldest first, sorted by timestamp in filename):
   - Read the JSON. It contains `framework`, `sourceHints`, `changes`, and a pre-built `prompt`.
   - Apply the changes to source code (see "How to apply" below).
   - Delete the batch file after successful application: `rm .moldui/batch-{timestamp}.json`

3. **Report back** — list files modified and summarize changes.

## How to apply changes

Each change has a `type` field. Handle them as follows:

### `style` — CSS changes
```json
{
  "type": "style",
  "element": { "tag": "div", "id": null, "classes": ["card", "p-6"] },
  "selector": "main > section:nth-child(2) > div.grid > div:first-child",
  "changes": {
    "padding": { "from": "24px", "to": "32px" },
    "borderRadius": { "from": "8px", "to": "16px" }
  }
}
```

**Steps:**
1. Use `sourceHints` from the batch to locate the file (they're ordered by confidence).
2. If the project uses Tailwind, update class names:
   - `padding: 24px → 32px` means `p-6 → p-8` (base 4px, so `{N}px → {N/4}`)
   - `border-radius: 8px → 16px` means `rounded-lg → rounded-2xl`
3. If the project uses CSS/SCSS/CSS-Modules, update the corresponding stylesheet.
4. If inline styles, update the `style` attribute.

### `text` — Text content change
```json
{
  "type": "text",
  "element": { "tag": "h1", "classes": ["hero-title"] },
  "oldText": "Welcome to My App",
  "newText": "Ship Faster with AI"
}
```

**Steps:**
1. Grep the codebase for the `oldText` (escape regex chars).
2. Replace with `newText`, preserving surrounding quotes and whitespace.
3. If `oldText` appears multiple times, use `sourceHints` + element context to pick the right match.

### `reorder` — Element moved within/between containers
```json
{
  "type": "reorder",
  "element": { "tag": "div", "classes": ["card"] },
  "fromIndex": 2, "toIndex": 0,
  "fromParent": "main > section.cards",
  "toParent": "main > section.cards"
}
```

**Steps:**
1. Find the parent container in source.
2. Move the child element from `fromIndex` to `toIndex`.
3. If `fromParent !== toParent`, the element moved to a different container — edit both locations.

### `swap` — Two elements exchange positions
```json
{
  "type": "swap",
  "element": { "tag": "div", "classes": ["card-a"] },
  "selector": "main section:nth-of-type(1)",
  "swapWith": { "tag": "div", "classes": ["card-b"] },
  "swapSelector": "main section:nth-of-type(3)"
}
```

**Steps:** Swap the source positions of the two elements in the same file. If JSX, swap the two JSX nodes.

### `clone` — Element duplicated
```json
{
  "type": "clone",
  "element": { "tag": "div", "classes": ["card"] },
  "index": 3
}
```

**Steps:** Duplicate the element in source at the given position.

### `delete` — Element removed
```json
{
  "type": "delete",
  "element": { "tag": "div", "classes": ["cta-banner"] },
  "selector": "main > div.cta-banner"
}
```

**Steps:** Remove the matching element from source. Be conservative — if not confident, ask the user.

### `wrap` — Element wrapped in a new container
```json
{
  "type": "wrap",
  "element": { "tag": "p", "classes": ["subtitle"] },
  "wrapperTag": "div"
}
```

**Steps:** Wrap the element in source with the given tag.

### `image` — Image src replaced
```json
{
  "type": "image",
  "element": { "tag": "img" },
  "oldSrc": "/hero.jpg",
  "newSrc": "https://example.com/new-hero.png"
}
```

**Steps:** Update the `src` attribute. If `newSrc` is a data URL (uploaded file), consider saving it to the public assets folder and using a relative path.

### `chat` — Natural language request
```json
{
  "type": "chat",
  "prompt": "make this more modern and add a subtle gradient",
  "element": { "tag": "div", "classes": ["hero"] },
  "selector": "section.hero"
}
```

**Steps:** Interpret the prompt in the context of the selected element. Make appropriate code changes. This is the most open-ended change type — use judgment.

## Tailwind class mapping (common values)

| CSS                    | Tailwind              |
|------------------------|-----------------------|
| `padding: 16px`        | `p-4`                 |
| `padding: 24px`        | `p-6`                 |
| `padding: 32px`        | `p-8`                 |
| `margin: 16px`         | `m-4`                 |
| `gap: 16px`            | `gap-4`               |
| `border-radius: 4px`   | `rounded`             |
| `border-radius: 8px`   | `rounded-lg`          |
| `border-radius: 12px`  | `rounded-xl`          |
| `border-radius: 16px`  | `rounded-2xl`         |
| `font-size: 14px`      | `text-sm`             |
| `font-size: 16px`      | `text-base`           |
| `font-size: 18px`      | `text-lg`             |
| `font-size: 20px`      | `text-xl`             |
| `font-size: 24px`      | `text-2xl`            |

Base unit = 4px. So `{N}px` → `{N/4}`.

## Framework-specific hints

- **Next.js / React**: JSX files at `app/*/page.tsx`, `pages/*/index.tsx`, `components/*.tsx`
- **Vue**: Single-file components `.vue` with `<template>`, `<script>`, `<style>` blocks
- **Svelte**: `.svelte` files with `<script>`, markup, `<style>` blocks
- **Angular**: `*.component.html` for template, `*.component.scss` for styles
- **Django**: Template files in `templates/` directory, classes often in separate CSS
- **Rails**: ERB templates in `app/views/`, styles in `app/assets/stylesheets/`
- **Laravel**: Blade templates `resources/views/*.blade.php`
- **Static HTML**: Edit the HTML directly, styles in `<style>` block or linked CSS

## Principles

1. **Minimal edits** — change only what's needed. Preserve existing code style, formatting, indentation.
2. **Prefer Tailwind classes over inline styles** if the project uses Tailwind.
3. **Use `sourceHints` first** — they're ranked by confidence.
4. **Ask when uncertain** — if multiple files match, present options to the user.
5. **Delete batch files** after successful application. Leave failed/partial batches for retry.

## When done

Tell the user:
- Which files were modified
- Summary of changes applied
- Any changes you couldn't apply (and why)
