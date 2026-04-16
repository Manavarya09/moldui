# moldui — Visual Editor Integration

## When to act

When the user says "sync moldui", "apply visual edits", "apply moldui changes", or similar.

## Protocol

1. Read `.moldui/INSTRUCTIONS.md` for the complete protocol (covers all change types and how to apply them).
2. Check for pending batches: `ls .moldui/batch-*.json`
3. Process each batch in chronological order (filename timestamp). For each:
   - Read the JSON (`framework`, `sourceHints`, `changes`)
   - Apply changes to source code
   - Delete the batch file after successful application
4. Report back with files modified and summary.

## Change types

`style`, `text`, `reorder`, `clone`, `delete`, `wrap`, `image`, `chat` — see INSTRUCTIONS.md for details.

## Tailwind projects

Translate px to Tailwind classes (4px base unit):
- `padding: 24px` → `p-6`
- `border-radius: 16px` → `rounded-2xl`
- `font-size: 16px` → `text-base`

Use `sourceHints` in each batch to locate the right source file.
