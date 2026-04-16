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
          spinner.fail('No dev server found. Start your dev server first, or pass the port:');
          console.log(chalk.gray('\n  moldui 3000'));
          console.log(chalk.gray('  moldui http://localhost:5173\n'));
          process.exit(1);
        }
      }

      // Verify port is active
      const isActive = await detectDevServer(targetPort);
      if (!isActive) {
        spinner.fail('Nothing running on port ' + targetPort);
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
      console.error(chalk.red('\n  ' + err.message + '\n'));
      process.exit(1);
    }
  });

// Sync changes to source code by writing batch files that Claude Code picks up
async function syncChanges(changes, framework, projectDir, hub) {
  hub.sendToBrowser({ type: 'status', payload: { state: 'writing' } });

  // Build source hints from all changes
  const allHints = [];
  for (const change of changes) {
    if (change.element) {
      const hints = mapElementToSource(change.element, framework, projectDir);
      allHints.push(...hints);
    }
  }

  // Deduplicate hints
  const seen = new Set();
  const uniqueHints = allHints.filter(h => { if (seen.has(h.file)) return false; seen.add(h.file); return true; });

  // Write the batch to a pending file for Claude Code to pick up via /moldui-sync command
  const moldDir = join(projectDir, '.moldui');
  mkdirSync(moldDir, { recursive: true });
  const batchFile = join(moldDir, `batch-${Date.now()}.json`);
  const batch = {
    timestamp: Date.now(),
    framework,
    sourceHints: uniqueHints,
    changes,
    prompt: buildSyncPrompt(changes, framework, uniqueHints),
  };
  writeFileSync(batchFile, JSON.stringify(batch, null, 2), 'utf-8');

  // Pretty print a summary (not the whole prompt — too noisy)
  console.log(chalk.gray('\n  ── ' + changes.length + ' change' + (changes.length === 1 ? '' : 's') + ' queued → .moldui/' + batchFile.split('/').pop() + ' ──'));
  for (const c of changes.slice(0, 5)) {
    const summary = c.type === 'style' ? Object.keys(c.changes || {}).join(', ')
      : c.type === 'text' ? '"' + (c.oldText || '').slice(0, 20) + '" → "' + (c.newText || '').slice(0, 20) + '"'
      : c.type === 'reorder' ? 'moved ' + c.fromIndex + ' → ' + c.toIndex
      : c.type;
    console.log(chalk.dim('    · [' + c.type + '] ' + (c.element?.tag || 'el') + ' — ' + summary));
  }
  if (changes.length > 5) console.log(chalk.dim('    · ...and ' + (changes.length - 5) + ' more'));
  console.log(chalk.cyan('\n  In Claude Code, run: /moldui-sync'));
  console.log(chalk.gray('  (or tell Claude to "apply my moldui changes")\n'));

  // Notify browser that the batch is pending
  const file = uniqueHints[0]?.file || 'source';
  hub.sendToBrowser({ type: 'synced', payload: { file, changes: changes.length, pending: true } });
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
