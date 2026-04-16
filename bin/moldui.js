#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import open from 'open';
import { mkdirSync, writeFileSync, readdirSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
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

      // Handle incoming changes
      hub.on('change', (change) => {
        pendingChanges.push(change);
        undo.push(change);

        // Debounce: wait 1.5s of inactivity then sync
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          if (pendingChanges.length === 0) return;
          const batch = pendingChanges.splice(0);
          syncChanges(batch, framework, projectDir, hub);
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
          syncChanges(batch, framework, projectDir, hub);
        }, 1500);
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
async function syncChanges(changes, framework, projectDir, hub) {
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
  console.log(chalk.cyan('\n  In Claude Code: ') + chalk.bold('/moldui-sync'));
  console.log(chalk.gray('  (or tell any AI to "apply my moldui changes")\n'));

  // Notify browser that the batch is pending
  const file = uniqueHints[0]?.file || 'source';
  hub.sendToBrowser({ type: 'synced', payload: { file, changes: compressed.length, pending: true } });
  hub.sendToBrowser({ type: 'status', payload: { state: 'idle' } });
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

program.parse();
