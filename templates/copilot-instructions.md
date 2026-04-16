# moldui — Visual Editor Integration

When the user asks to sync or apply moldui changes:

1. Read `.moldui/INSTRUCTIONS.md` for the full protocol
2. List pending batches: files matching `.moldui/batch-*.json`
3. For each batch (process by timestamp, oldest first):
   - Read the JSON (contains `framework`, `sourceHints`, `changes`)
   - Apply each change to source code using the appropriate strategy (see INSTRUCTIONS.md)
   - Delete the batch file after successful application
4. Report files modified and a summary of changes

Supported change types: `style`, `text`, `reorder`, `clone`, `delete`, `wrap`, `image`, `chat`.

When the project uses Tailwind CSS, translate pixel values to Tailwind utility classes (4px base unit).
