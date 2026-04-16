---
name: moldui-sync
description: "Apply pending visual edits from moldui to source code. Triggers: /moldui-sync, apply my moldui changes, sync visual edits, apply canvas edits"
---

# moldui-sync — Apply Visual Edits to Source Code

This skill reads pending visual edit batches from `.moldui/` in the current project and translates them into source code edits.

## When to Invoke

- User runs `/moldui-sync`
- User says "apply my moldui changes" / "sync my visual edits" / "apply canvas edits"
- User has made visual edits in their browser via `moldui` and clicked Save

## Steps

1. **Check for pending batches**
   ```
   ls -1 .moldui/batch-*.json 2>/dev/null
   ```
   If no batches found, tell the user: "No pending moldui edits found. Run `npx moldui` and make some visual changes first."

2. **Read all pending batches** in chronological order (sorted by timestamp in filename). Each batch is JSON with:
   - `timestamp`: when the batch was created
   - `framework`: detected framework (e.g. nextjs, vite, vue, static)
   - `sourceHints`: array of `{ file, confidence, reason }` — likely source files
   - `changes`: array of change descriptors
   - `prompt`: pre-built prompt describing changes

3. **For each batch, apply changes intelligently:**

   For **style changes** (type: `style`):
   - Look at `element.classes` to find the element in source
   - If framework is Tailwind, update class names (e.g. `p-6` → `p-8` when padding changes from 24px to 32px)
   - If using CSS modules or scoped CSS, edit the stylesheet
   - If inline styles, update them
   - Use the `changes` object: `{ padding: { from: "24px", to: "32px" } }`

   For **text changes** (type: `text`):
   - Search for `oldText` in source files (prefer files from `sourceHints`)
   - Replace with `newText`
   - Preserve surrounding whitespace and quotes

   For **reorder changes** (type: `reorder`):
   - Find the parent container by `fromParent` selector or class names
   - Move the child element from `fromIndex` to `toIndex`
   - If `fromParent !== toParent`, move the element to a different container

   For **swap changes** (type: `swap`):
   - The user held Alt while dragging to exchange two elements' positions
   - Swap the source positions of `selector` and `swapSelector`
   - If in JSX: swap the two JSX elements in their source tree
   - If in HTML: swap the two HTML elements

   For **clone changes** (type: `clone`):
   - Duplicate the element in source code at the specified position

4. **Use `sourceHints` first** — these are the most likely source files. Read them first, then grep if needed.

5. **Edit files minimally** — preserve existing code style, formatting, indentation.

6. **After applying each batch, delete it:**
   ```
   rm .moldui/batch-{timestamp}.json
   ```

7. **Report to the user:**
   - List files modified
   - Summary of changes applied
   - Any changes that couldn't be applied (and why)

## Tailwind Class Mapping

When the framework uses Tailwind CSS, translate CSS values to Tailwind classes:

| CSS                    | Tailwind              |
|------------------------|-----------------------|
| `padding: 24px`        | `p-6`                 |
| `padding: 32px`        | `p-8`                 |
| `margin: 16px`         | `m-4`                 |
| `gap: 16px`            | `gap-4`               |
| `border-radius: 8px`   | `rounded-lg`          |
| `border-radius: 12px`  | `rounded-xl`          |
| `border-radius: 16px`  | `rounded-2xl`         |
| `font-size: 16px`      | `text-base`           |
| `font-size: 18px`      | `text-lg`             |
| `font-size: 24px`      | `text-2xl`            |
| `width: 100%`          | `w-full`              |

Base unit = 4px. So `{N}px` → `{N/4}` (e.g., `12px` → `3`).

## Framework-Specific Tips

**Next.js / React:**
- JSX files at `app/*/page.tsx`, `pages/*/index.tsx`, `components/*.tsx`
- Look for matching class strings or text content

**Vue:**
- SFC files: `<template>`, `<script>`, `<style>`
- Edit classes in the template

**Svelte:**
- `.svelte` files with `<script>`, HTML, and `<style>`

**Django/Rails/Laravel:**
- Template files with class="..." attributes
- For styles, find the corresponding CSS file

**Static HTML:**
- Edit the HTML directly
- For styles, edit the `<style>` block or linked CSS

## Example Interaction

```
User: /moldui-sync

Claude: Found 1 pending batch with 3 changes.

Reading batch-1713300000000.json...
Framework: nextjs + tailwind
Source hints: src/app/page.tsx (route match)

Applied changes:
✓ src/app/page.tsx — padding p-6 → p-8 on .card (3 instances)
✓ src/app/page.tsx — text "Welcome to My App" → "Ship Faster with AI" (h1)
✓ src/app/page.tsx — reordered grid children [0,1,2] → [2,0,1]

Deleted batch file.
```

## Edge Cases

- **Multiple matches for a class**: Apply to all matches. If the change should be scoped, Claude should note this and ask.
- **Source file not obvious**: Grep across the project for the class/text. If still unclear, show the user the change and ask which file to edit.
- **Text contains special regex chars**: Escape them before searching.
- **Reorder across different files**: If an element is moved to a different parent and that parent lives in a different file, handle the cross-file case by editing both.
- **Unknown framework**: Fall back to grep-based file matching and editing raw HTML/CSS.
