---
name: canvas
description: "Visual editor overlay for any running web app. Drag, resize, edit text, change styles in the browser — changes sync to source code. Triggers: /canvas, visual edit, drag drop editor, mold UI"
---

# clayui — Visual Editor

Launch a visual editing overlay on any running dev server. The user can drag elements, resize them, edit text inline, and adjust styles — all changes are synced back to source code.

## Usage

```
/canvas              # Auto-detect dev server
/canvas 3000         # Specify port
/canvas stop         # Stop the editor
```

## How It Works

1. Detect the user's running dev server (scans common ports)
2. Start an HTTP proxy that injects the editor overlay into HTML responses
3. Open the browser with the editor active
4. User makes visual changes (drag, resize, text, styles)
5. Changes stream via WebSocket as structured descriptors
6. Build a prompt describing the DOM changes for Claude to translate to source code edits
7. Claude reads the relevant source files and makes minimal edits

## When Changes Arrive

The WebSocket sends change descriptors. Build a sync prompt and execute the edits:

1. Read the change descriptors from the WebSocket
2. Use the element-to-source mapper to find likely source files
3. Read those source files
4. Make minimal edits to reflect the visual changes
5. Preserve existing code style
6. For Tailwind projects: update class names (e.g., `p-6` → `p-8`)
7. For CSS: update the stylesheet or scoped styles
8. For text changes: update the string literal or text node

## Starting the Editor

```bash
node ${CLAUDE_PLUGIN_ROOT}/bin/clayui.js [port]
```

The editor proxy starts and auto-opens the browser. Changes arrive as structured JSON via WebSocket.
