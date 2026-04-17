#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import open from 'open';
import { mkdirSync, writeFileSync, readdirSync, unlinkSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { spawn } from 'child_process';
import { execSync } from 'child_process';
import { createProxy } from '../src/proxy.js';
import { createWebSocketHub } from '../src/websocket.js';
import { detectDevServer, detectFramework, findAvailablePort } from '../src/detector.js';
import { mapElementToSource } from '../src/mapper.js';
import { buildSyncPrompt } from '../src/differ.js';
import { UndoManager } from '../src/undo.js';

const program = new Command();

program
  .name('moldui')
  .description('Mold your UI like clay. Visual editor overlay for any running web app.')
  .version('1.0.0');

program
  .argument('[target]', 'dev server URL or port (auto-detects if omitted)')
  .option('-p, --proxy-port <port>', 'proxy server port', parseInt)
  .option('--ws-port <port>', 'WebSocket port', parseInt)
  .option('--no-open', 'do not auto-open browser')
  .option('--dir <path>', 'project directory', process.cwd())
  .option('--no-auto-sync', 'disable auto-running Claude on Save (keeps batches in .moldui/)')
  .option('--auto-apply', 'apply changes without diff preview (default: preview first)')
  .action(async (target, opts) => {
    console.log('');
    console.log(chalk.bold('  moldui'));
    console.log(chalk.gray('  Mold your UI like clay.'));
    console.log('');

    const spinner = ora('Detecting dev server...').start();

    try {
      // ── Detect target ────────────────────────────────────
      let targetPort;

      if (target) {
        if (/^\d+$/.test(target)) {
          targetPort = parseInt(target);
        } else if (target.startsWith('http')) {
          try {
            const url = new URL(target);
            targetPort = parseInt(url.port) || (url.protocol === 'https:' ? 443 : 80);
          } catch {
            spinner.fail('Invalid URL: ' + target);
            process.exit(1);
          }
        } else {
          targetPort = parseInt(target) || null;
        }
      }

      // Auto-detect if no target
      if (!targetPort) {
        targetPort = await detectDevServer();
        if (!targetPort) {
          spinner.fail('No dev server found on common ports (3000, 5173, 8080, ...)');
          console.log('');
          console.log(chalk.bold('  What to do:'));
          console.log(chalk.gray('    1. Start your dev server in another terminal'));
          console.log(chalk.gray('       npm run dev   / npm start   / python -m http.server'));
          console.log(chalk.gray('    2. Then run:'));
          console.log(chalk.cyan('       moldui               ') + chalk.gray('(auto-detect)'));
          console.log(chalk.cyan('       moldui 3000          ') + chalk.gray('(specific port)'));
          console.log(chalk.cyan('       moldui localhost:5173'));
          console.log('');
          process.exit(1);
        }
      }

      // Verify port is active
      const isActive = await detectDevServer(targetPort);
      if (!isActive) {
        spinner.fail('Nothing running on port ' + targetPort);
        console.log('');
        console.log(chalk.gray('  Your dev server is not responding on localhost:' + targetPort + '.'));
        console.log(chalk.gray('  Start it first, then run moldui again.\n'));
        process.exit(1);
      }

      spinner.text = 'Detecting framework...';

      // ── Detect framework ─────────────────────────────────
      const framework = detectFramework(opts.dir);
      const fwLabel = framework.name !== 'unknown'
        ? framework.name + (framework.styling !== 'css' ? ' + ' + framework.styling : '')
        : 'unknown';

      spinner.text = 'Starting proxy...';

      // ── Find available ports ─────────────────────────────
      const proxyPort = opts.proxyPort || await findAvailablePort(4444);
      const wsPort = opts.wsPort || await findAvailablePort(proxyPort + 1);

      // ── Start proxy server ───────────────────────────────
      const { server } = createProxy(targetPort, proxyPort, wsPort);
      server.listen(proxyPort, () => {});

      // ── Start WebSocket hub ──────────────────────────────
      const hub = createWebSocketHub(wsPort);
      const undo = new UndoManager();
      const projectDir = opts.dir;

      // Clean old sync batches + write .gitignore entry
      cleanOldBatches(projectDir);
      const moldDir = join(projectDir, '.moldui');
      mkdirSync(moldDir, { recursive: true });
      const giPath = join(moldDir, '.gitignore');
      if (!existsSync(giPath)) writeFileSync(giPath, '*\n!.gitignore\n!README.md\n');
      const readmePath = join(moldDir, 'README.md');
      if (!existsSync(readmePath)) writeFileSync(readmePath, '# .moldui\n\nThis directory holds pending visual edits from [moldui](https://github.com/Manavarya09/moldui).\n\nRun `/moldui-sync` in Claude Code to apply pending changes to your source code.\n');
      let debounceTimer = null;
      let pendingChanges = [];

      // Auto-sync mode: detect Claude Code CLI
      const claudeAvailable = opts.autoSync !== false && detectClaude();
      if (claudeAvailable) {
        console.log(chalk.green('  Auto-sync:   ') + chalk.cyan('enabled') + chalk.gray(' (Claude Code detected)'));
      } else if (opts.autoSync !== false) {
        console.log(chalk.yellow('  Auto-sync:   ') + chalk.gray('disabled (install Claude Code CLI to enable)'));
      }

      // Handle incoming changes
      hub.on('change', (change) => {
        pendingChanges.push(change);
        undo.push(change);

        // Debounce: wait 1.5s of inactivity then sync
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          if (pendingChanges.length === 0) return;
          const batch = pendingChanges.splice(0);
          syncChanges(batch, framework, projectDir, hub, { claudeAvailable, autoApply: opts.autoApply });
        }, 1500);
      });

      hub.on('batch', (changes) => {
        for (const c of changes) {
          pendingChanges.push(c);
          undo.push(c);
        }
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          if (pendingChanges.length === 0) return;
          const batch = pendingChanges.splice(0);
          syncChanges(batch, framework, projectDir, hub, { claudeAvailable, autoApply: opts.autoApply });
        }, 1500);
      });

      // ── Explicit browser "apply" trigger (Accept button in diff preview) ──
      hub.on('apply', (payload) => {
        const batchPath = payload && payload.batchFile;
        if (!batchPath) return;
        if (!claudeAvailable) {
          hub.sendToBrowser({ type: 'error', payload: { message: 'Claude Code CLI not installed. Run /moldui-sync manually.' } });
          return;
        }
        runClaudeSync(projectDir, hub, batchPath);
      });

      // ── Reject: delete the batch without applying ──
      hub.on('reject', (payload) => {
        const batchPath = payload && payload.batchFile;
        if (batchPath && existsSync(batchPath)) {
          try { unlinkSync(batchPath); } catch {}
          hub.sendToBrowser({ type: 'rejected', payload: { file: batchPath.split('/').pop() } });
        }
      });

      // ── AI Suggest: generate variations of a selected element ──
      hub.on('suggest', (payload) => {
        if (!claudeAvailable) {
          hub.sendToBrowser({ type: 'error', payload: { message: 'Claude Code CLI needed for AI suggestions.' } });
          return;
        }
        runClaudeSuggest(projectDir, hub, payload);
      });

      hub.on('undo', () => {
        const entry = undo.undo();
        if (entry) {
          hub.sendToBrowser({ type: 'undo-applied', payload: entry });
        }
      });

      hub.on('redo', () => {
        const entry = undo.redo();
        if (entry) {
          hub.sendToBrowser({ type: 'redo-applied', payload: entry });
        }
      });

      spinner.succeed('Ready!');
      console.log('');
      console.log('  ' + chalk.green('Dev server:') + '  localhost:' + targetPort);
      console.log('  ' + chalk.green('Editor:') + '      ' + chalk.cyan('http://localhost:' + proxyPort));
      console.log('  ' + chalk.green('WebSocket:') + '   localhost:' + wsPort);
      console.log('  ' + chalk.green('Framework:') + '   ' + fwLabel);
      console.log('  ' + chalk.green('Project:') + '     ' + projectDir);
      console.log('');
      console.log(chalk.gray('  Click elements to select. Drag to move. Double-click to edit text.'));
      console.log(chalk.gray('  Press S for style panel. Cmd+Z to undo. Escape to deselect.'));
      console.log('');

      // Auto-open browser
      if (opts.open !== false) {
        await open('http://localhost:' + proxyPort);
      }

      // Keep alive
      process.on('SIGINT', () => {
        console.log(chalk.gray('\n  Shutting down...'));
        hub.close();
        server.close();
        process.exit(0);
      });

    } catch (err) {
      spinner.fail('Failed to start');
      console.error('');
      const msg = err.message || String(err);

      // Friendly error decoder — map common errors to actionable fixes
      if (msg.includes('EADDRINUSE')) {
        const portMatch = msg.match(/:(\d+)/);
        const port = portMatch ? portMatch[1] : 'the chosen port';
        console.error(chalk.red('  Port ' + port + ' is already in use.'));
        console.error(chalk.gray('\n  Try a different proxy port:'));
        console.error(chalk.cyan('    moldui ' + (target || '3000') + ' --proxy-port 5555\n'));
      } else if (msg.includes('EACCES') || msg.includes('permission')) {
        console.error(chalk.red('  Permission denied.'));
        console.error(chalk.gray('\n  Try a port above 1024:'));
        console.error(chalk.cyan('    moldui --proxy-port 4444\n'));
      } else if (msg.includes('ENOTFOUND') || msg.includes('ECONNREFUSED')) {
        console.error(chalk.red('  Could not connect to the dev server.'));
        console.error(chalk.gray('\n  Make sure it is running and the port is correct.\n'));
      } else {
        console.error(chalk.red('  ' + msg));
        console.error(chalk.gray('\n  Need help? https://github.com/Manavarya09/moldui/issues\n'));
      }
      process.exit(1);
    }
  });

// Compress changes: coalesce multiple edits to the same element+property into one
// Keeps the ORIGINAL from-value and the LATEST to-value. Drops redundant fields.
function compressChanges(changes) {
  const byKey = new Map();
  const out = [];

  for (const c of changes) {
    // Non-style/text changes: keep as-is but strip redundant fields
    if (c.type !== 'style' && c.type !== 'text') {
      out.push(stripChange(c));
      continue;
    }

    const key = c.selector || JSON.stringify(c.element?.classes || []) + ':' + (c.element?.tag || '');

    if (c.type === 'style') {
      const existing = byKey.get(key);
      if (existing && existing.type === 'style') {
        // Merge style change: keep existing "from" values, use new "to" values
        for (const [prop, val] of Object.entries(c.changes || {})) {
          if (existing.changes[prop]) {
            existing.changes[prop].to = val.to; // keep original from
          } else {
            existing.changes[prop] = { from: val.from, to: val.to };
          }
        }
        continue;
      }
      const stripped = stripChange(c);
      byKey.set(key, stripped);
      out.push(stripped);
    } else if (c.type === 'text') {
      // For text: last one wins, but keep the original "oldText"
      const existing = byKey.get(key);
      if (existing && existing.type === 'text') {
        existing.newText = c.newText;
        continue;
      }
      const stripped = stripChange(c);
      byKey.set(key, stripped);
      out.push(stripped);
    }
  }

  // Final pass: drop style changes where from === to (net zero)
  return out.filter(c => {
    if (c.type !== 'style' || !c.changes) return true;
    for (const k of Object.keys(c.changes)) {
      if (c.changes[k].from === c.changes[k].to) delete c.changes[k];
    }
    return Object.keys(c.changes).length > 0;
  });
}

// Strip redundant / verbose fields from a change descriptor to save tokens
function stripChange(c) {
  const out = { type: c.type };
  if (c.selector) out.selector = c.selector;
  if (c.element) {
    // Keep only what the AI actually needs to locate the element
    const el = c.element;
    const slim = { tag: el.tag };
    if (el.id) slim.id = el.id;
    if (el.classes && el.classes.length) slim.classes = el.classes;
    if (el.textContent && c.type === 'text') {
      // Text change already carries oldText/newText, drop element.textContent
    } else if (el.textContent) {
      slim.textContent = el.textContent.slice(0, 60);
    }
    out.element = slim;
  }
  if (c.changes) out.changes = c.changes;
  if (c.oldText !== undefined) out.oldText = c.oldText;
  if (c.newText !== undefined) out.newText = c.newText;
  if (c.fromIndex !== undefined) out.fromIndex = c.fromIndex;
  if (c.toIndex !== undefined) out.toIndex = c.toIndex;
  if (c.fromParent) out.fromParent = c.fromParent;
  if (c.toParent && c.toParent !== c.fromParent) out.toParent = c.toParent;
  if (c.wrapperTag) out.wrapperTag = c.wrapperTag;
  if (c.oldSrc) out.oldSrc = c.oldSrc;
  if (c.newSrc) out.newSrc = c.newSrc;
  if (c.index !== undefined) out.index = c.index;
  if (c.prompt) out.prompt = c.prompt;
  // Drop: url, siblingCount, rect, dataLength — not needed for source edits
  return out;
}

// Rough token count (~4 chars per token)
const estTokens = (str) => Math.ceil(str.length / 4);

// Sync changes to source code by writing batch files that Claude Code picks up
async function syncChanges(changes, framework, projectDir, hub, opts = {}) {
  hub.sendToBrowser({ type: 'status', payload: { state: 'writing' } });

  // ── Token optimization: dedupe + strip ──
  const rawJson = JSON.stringify(changes);
  const compressed = compressChanges(changes);
  const compressedJson = JSON.stringify(compressed);
  const savedPct = Math.round((1 - compressedJson.length / rawJson.length) * 100);
  const savedTokens = estTokens(rawJson) - estTokens(compressedJson);

  // Build source hints from compressed changes
  const allHints = [];
  for (const change of compressed) {
    if (change.element) {
      const hints = mapElementToSource(change.element, framework, projectDir);
      allHints.push(...hints);
    }
  }

  // Deduplicate hints
  const seen = new Set();
  const uniqueHints = allHints.filter(h => { if (seen.has(h.file)) return false; seen.add(h.file); return true; });

  // Write the batch to a pending file for Claude to pick up via /moldui-sync command
  const moldDir = join(projectDir, '.moldui');
  mkdirSync(moldDir, { recursive: true });
  const batchFile = join(moldDir, `batch-${Date.now()}.json`);
  const batch = {
    v: 2,
    timestamp: Date.now(),
    framework: { name: framework.name, styling: framework.styling }, // strip router/devScript
    sourceHints: uniqueHints.slice(0, 5).map(h => ({ file: h.file, reason: h.reason })), // top 5, drop confidence
    changes: compressed,
  };
  writeFileSync(batchFile, JSON.stringify(batch, null, 2), 'utf-8');

  // Pretty print a summary
  console.log(chalk.gray('\n  ── ' + compressed.length + ' change' + (compressed.length === 1 ? '' : 's') + ' queued → .moldui/' + batchFile.split('/').pop() + ' ──'));
  if (changes.length > compressed.length) {
    console.log(chalk.dim('    coalesced ' + changes.length + ' edits → ' + compressed.length + ' (' + savedPct + '% smaller, ~' + savedTokens + ' tokens saved)'));
  }
  for (const c of compressed.slice(0, 5)) {
    const summary = c.type === 'style' ? Object.keys(c.changes || {}).join(', ')
      : c.type === 'text' ? '"' + (c.oldText || '').slice(0, 20) + '" → "' + (c.newText || '').slice(0, 20) + '"'
      : c.type === 'reorder' ? 'moved ' + c.fromIndex + ' → ' + c.toIndex
      : c.type;
    console.log(chalk.dim('    · [' + c.type + '] ' + (c.element?.tag || 'el') + ' — ' + summary));
  }
  if (compressed.length > 5) console.log(chalk.dim('    · ...and ' + (compressed.length - 5) + ' more'));

  // Auto-sync: run Claude headless if --auto-apply is on AND Claude is available
  if (opts.claudeAvailable && opts.autoApply) {
    console.log(chalk.cyan('\n  Auto-applying via Claude...\n'));
    runClaudeSync(projectDir, hub, batchFile);
    return;
  }

  // Send batch info to browser so it can show diff preview + Accept/Reject buttons
  hub.sendToBrowser({
    type: 'batch-pending',
    payload: {
      batchFile,
      changes: compressed.length,
      sourceHints: uniqueHints.slice(0, 5).map(h => h.file),
      claudeAvailable: !!opts.claudeAvailable
    }
  });
  hub.sendToBrowser({ type: 'status', payload: { state: 'idle' } });

  if (opts.claudeAvailable) {
    console.log(chalk.cyan('\n  Browser: ') + chalk.gray('click ') + chalk.bold.cyan('Apply') + chalk.gray(' to run Claude headless'));
  } else {
    console.log(chalk.cyan('\n  In Claude Code: ') + chalk.bold('/moldui-sync'));
    console.log(chalk.gray('  (or tell any AI to "apply my moldui changes")\n'));
  }
}

// ── Detect Claude Code CLI ─────────────────────────────────
// Uses execSync with PATH lookup (no user-controlled input)
function detectClaude() {
  try {
    execSync('command -v claude', { stdio: 'ignore' });
    return true;
  } catch { return false; }
}

// ── Run Claude headless and stream progress to browser ─────
// Uses spawn with array args (not exec) — no shell, no injection risk.
// batchFile path comes from our own mkstemp-style Date.now() filename.
function runClaudeSync(projectDir, hub, batchFile) {
  hub.sendToBrowser({ type: 'status', payload: { state: 'writing', file: batchFile.split('/').pop() } });
  hub.sendToBrowser({ type: 'claude-start', payload: { batchFile } });

  const prompt = [
    'Apply the moldui visual edit batch at ' + batchFile + ' to source code.',
    'Read the batch JSON, then for each change apply it to the corresponding source file.',
    'Use sourceHints to locate files. Prefer Tailwind class updates when the project uses Tailwind.',
    'For text changes: find the oldText and replace with newText.',
    'For style changes: update CSS/Tailwind classes on the element.',
    'For reorder/delete/wrap/clone: modify the source accordingly.',
    'Make minimal edits. Preserve code style. After applying, delete the batch file.',
    'Report each file you modified as a brief bullet.'
  ].join('\n');

  const proc = spawn('claude', ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--dangerously-skip-permissions', '--no-session-persistence'], {
    cwd: projectDir,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const filesTouched = new Set();
  let buf = '';

  proc.stdout.on('data', (chunk) => {
    buf += chunk.toString();
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        handleClaudeEvent(msg, hub, filesTouched);
      } catch { /* partial line */ }
    }
  });

  proc.stderr.on('data', (chunk) => { process.stderr.write(chalk.dim(chunk)); });

  proc.on('close', (code) => {
    hub.sendToBrowser({
      type: 'claude-done',
      payload: { success: code === 0, filesTouched: Array.from(filesTouched), batchFile }
    });
    hub.sendToBrowser({ type: 'status', payload: { state: 'idle' } });
    if (code === 0) {
      console.log(chalk.green('  ✓ Applied') + chalk.gray(' — ' + filesTouched.size + ' file' + (filesTouched.size === 1 ? '' : 's') + ' changed'));
      // Suggest a commit message based on the files touched
      const commitMsg = buildCommitSuggestion(filesTouched);
      if (commitMsg) {
        console.log('');
        console.log(chalk.gray('  Suggested commit:'));
        console.log(chalk.cyan('    git add -A && git commit -m ' + JSON.stringify(commitMsg)));
        console.log('');
      }
    } else {
      console.log(chalk.red('  ✗ Claude exited with code ' + code));
      hub.sendToBrowser({ type: 'error', payload: { message: 'Claude sync failed (exit ' + code + ')' } });
    }
  });

  proc.on('error', (err) => {
    console.log(chalk.red('  ✗ Failed to run Claude: ' + err.message));
    hub.sendToBrowser({ type: 'error', payload: { message: 'Failed to run Claude: ' + err.message } });
  });
}

// Parse Claude stream-json events and translate into browser events
function handleClaudeEvent(msg, hub, filesTouched) {
  if (msg.type === 'assistant' && msg.message && Array.isArray(msg.message.content)) {
    for (const part of msg.message.content) {
      if (part.type === 'tool_use' && (part.name === 'Edit' || part.name === 'Write' || part.name === 'MultiEdit')) {
        const fp = part.input && (part.input.file_path || part.input.path);
        if (fp) {
          filesTouched.add(fp);
          hub.sendToBrowser({ type: 'claude-progress', payload: { action: part.name.toLowerCase(), file: fp } });
        }
      } else if (part.type === 'tool_use' && part.name === 'Read') {
        const fp = part.input && part.input.file_path;
        if (fp) hub.sendToBrowser({ type: 'claude-progress', payload: { action: 'reading', file: fp } });
      }
    }
  }
}

// ── AI Suggest: ask Claude for 2-3 variations of a selected element ──
function runClaudeSuggest(projectDir, hub, payload) {
  hub.sendToBrowser({ type: 'status', payload: { state: 'writing' } });
  hub.sendToBrowser({ type: 'suggest-start', payload: {} });

  const el = payload.element || {};
  const descr = (el.tag || 'element') + (el.id ? '#' + el.id : '') + (el.classes ? '.' + (el.classes || []).join('.') : '');
  const prompt = [
    'The user selected this element in their running web app: ' + descr,
    'Text content: "' + (el.textContent || '').slice(0, 100) + '"',
    'Selector: ' + (payload.selector || 'n/a'),
    'URL path: ' + (payload.url || '/'),
    '',
    'User context: "' + (payload.prompt || 'suggest 2-3 design variations') + '"',
    '',
    'Propose 2-3 concrete design variations as plain text. For each:',
    '- Name the variation (e.g. "Softer", "Bolder", "Spacious")',
    '- List the specific CSS/Tailwind changes (3-5 max)',
    '- Explain in 1 line why it improves the current design',
    '',
    'Output only the 2-3 variations as markdown. Do NOT modify any files.',
  ].join('\n');

  const proc = spawn('claude', ['-p', prompt, '--output-format', 'text', '--no-session-persistence'], {
    cwd: projectDir,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let out = '';
  proc.stdout.on('data', (c) => { out += c.toString(); });
  proc.stderr.on('data', (c) => { process.stderr.write(chalk.dim(c)); });
  proc.on('close', (code) => {
    hub.sendToBrowser({ type: 'suggest-result', payload: { text: out.trim(), success: code === 0 } });
    hub.sendToBrowser({ type: 'status', payload: { state: 'idle' } });
  });
  proc.on('error', (err) => {
    hub.sendToBrowser({ type: 'error', payload: { message: 'Failed to run Claude: ' + err.message } });
  });
}

// Clean old batch files on startup (keep last 20)
function cleanOldBatches(projectDir) {
  const moldDir = join(projectDir, '.moldui');
  if (!existsSync(moldDir)) return;
  try {
    const batches = readdirSync(moldDir)
      .filter(f => f.startsWith('batch-') && f.endsWith('.json'))
      .map(f => ({ f, t: parseInt(f.match(/\d+/)?.[0] || '0') }))
      .sort((a, b) => b.t - a.t);
    for (const { f } of batches.slice(20)) {
      try { unlinkSync(join(moldDir, f)); } catch {}
    }
  } catch {}
}

// ── Build a commit message from the files Claude touched ──
function buildCommitSuggestion(filesTouched) {
  if (!filesTouched || filesTouched.size === 0) return null;
  const files = Array.from(filesTouched);
  // Determine a terse summary from file paths
  const first = files[0].split('/').pop();
  if (files.length === 1) {
    return 'style: visual edits to ' + first + ' via moldui';
  }
  return 'style: moldui visual edits across ' + files.length + ' files';
}

program.parse();
