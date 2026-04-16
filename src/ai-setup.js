// moldui AI integration setup — detects installed AI assistants and writes rule files

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const templatesDir = join(__dirname, '..', 'templates');

// Each AI target: detection signal + output path + template filename
const AI_TARGETS = {
  claude: {
    label: 'Claude Code',
    detect: (dir) => existsSync(join(dir, '.claude')) || existsSync(join(dir, 'CLAUDE.md')),
    output: 'CLAUDE.md',
    template: null, // Claude uses the skill system (installed via plugin)
    command: '/moldui-sync',
  },
  cursor: {
    label: 'Cursor',
    detect: (dir) => existsSync(join(dir, '.cursorrules')) || existsSync(join(dir, '.cursor')),
    output: '.cursorrules',
    template: 'cursorrules',
    command: 'tell Cursor "apply moldui changes"',
  },
  copilot: {
    label: 'GitHub Copilot',
    detect: (dir) => existsSync(join(dir, '.github/copilot-instructions.md')) || existsSync(join(dir, '.vscode')),
    output: '.github/copilot-instructions.md',
    template: 'copilot-instructions.md',
    command: 'ask Copilot "apply moldui changes"',
  },
  windsurf: {
    label: 'Windsurf',
    detect: (dir) => existsSync(join(dir, '.windsurfrules')) || existsSync(join(dir, '.windsurf')),
    output: '.windsurfrules',
    template: 'windsurfrules',
    command: 'tell Windsurf "apply moldui"',
  },
  aider: {
    label: 'Aider',
    detect: (dir) => existsSync(join(dir, '.aider.conf.yml')) || existsSync(join(dir, '.aider.conf.yaml')),
    output: '.aider.conf.yml',
    template: 'aider.conf.yml',
    command: 'aider then "apply moldui"',
  },
  gemini: {
    label: 'Gemini CLI',
    detect: (dir) => existsSync(join(dir, 'GEMINI.md')) || existsSync(join(dir, '.gemini')),
    output: 'GEMINI.md',
    template: 'GEMINI.md',
    command: 'gemini "apply moldui"',
  },
  cline: {
    label: 'Cline',
    detect: (dir) => existsSync(join(dir, '.clinerules')) || existsSync(join(dir, '.cline')),
    output: '.clinerules',
    template: 'clinerules',
    command: 'ask Cline "apply moldui"',
  },
};

// Detect which AI assistants this project is set up for
export function detectAIs(projectDir) {
  const detected = [];
  for (const [key, target] of Object.entries(AI_TARGETS)) {
    if (target.detect(projectDir)) detected.push({ key, ...target });
  }
  return detected;
}

// Write the AI-agnostic INSTRUCTIONS.md into .moldui/
export function writeInstructions(projectDir) {
  const moldDir = join(projectDir, '.moldui');
  mkdirSync(moldDir, { recursive: true });
  const src = join(templatesDir, 'INSTRUCTIONS.md');
  const dst = join(moldDir, 'INSTRUCTIONS.md');
  if (existsSync(src)) {
    writeFileSync(dst, readFileSync(src, 'utf-8'), 'utf-8');
    return dst;
  }
  return null;
}

// Install rules for a specific AI (or 'all')
export function installAIRules(projectDir, aiKey = 'all', force = false) {
  const installed = [];
  const skipped = [];
  const keys = aiKey === 'all' ? Object.keys(AI_TARGETS) : [aiKey];

  for (const key of keys) {
    const target = AI_TARGETS[key];
    if (!target) { skipped.push({ key, reason: 'unknown AI' }); continue; }
    if (!target.template) { skipped.push({ key, reason: 'uses plugin system (no rule file needed)' }); continue; }

    const outputPath = join(projectDir, target.output);
    const templatePath = join(templatesDir, target.template);

    if (!existsSync(templatePath)) { skipped.push({ key, reason: 'template not found' }); continue; }

    if (existsSync(outputPath) && !force) {
      // Check if our marker is already present
      const existing = readFileSync(outputPath, 'utf-8');
      if (existing.includes('moldui')) {
        skipped.push({ key, reason: 'already configured' });
        continue;
      }
      // Append to existing file
      const content = readFileSync(templatePath, 'utf-8');
      writeFileSync(outputPath, existing.trimEnd() + '\n\n' + content, 'utf-8');
      installed.push({ key, path: target.output, label: target.label, mode: 'appended' });
    } else {
      // Ensure parent dir exists
      mkdirSync(dirname(outputPath), { recursive: true });
      const content = readFileSync(templatePath, 'utf-8');
      writeFileSync(outputPath, content, 'utf-8');
      installed.push({ key, path: target.output, label: target.label, mode: 'created' });
    }
  }

  return { installed, skipped };
}

// Get a human-readable sync command for a given AI
export function getSyncCommand(aiKey) {
  const t = AI_TARGETS[aiKey];
  return t ? t.command : 'tell your AI "apply moldui changes"';
}

// Return list of all supported AIs (for --list flag)
export function listAIs() {
  return Object.entries(AI_TARGETS).map(([key, t]) => ({ key, label: t.label, command: t.command }));
}
