import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import net from 'net';

const COMMON_PORTS = [3000, 3001, 5173, 5174, 4200, 8000, 8080, 8888, 4321, 1234];

export async function detectDevServer(explicitPort) {
  if (explicitPort) {
    const alive = await isPortActive(explicitPort);
    return alive ? explicitPort : null;
  }

  for (const port of COMMON_PORTS) {
    if (await isPortActive(port)) return port;
  }
  return null;
}

function isPortActive(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(300);
    socket.on('connect', () => { socket.destroy(); resolve(true); });
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
    socket.on('error', () => { socket.destroy(); resolve(false); });
    socket.connect(port, '127.0.0.1');
  });
}

export function detectFramework(dir = process.cwd()) {
  const result = { name: 'unknown', styling: 'css', router: null, files: {} };

  // Check package.json
  const pkgPath = join(dir, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

      // Framework detection
      if (allDeps['next']) {
        result.name = 'nextjs';
        result.router = existsSync(join(dir, 'app')) ? 'app' : 'pages';
      } else if (allDeps['nuxt']) {
        result.name = 'nuxt';
      } else if (allDeps['@angular/core']) {
        result.name = 'angular';
      } else if (allDeps['svelte'] || allDeps['@sveltejs/kit']) {
        result.name = allDeps['@sveltejs/kit'] ? 'sveltekit' : 'svelte';
      } else if (allDeps['vue']) {
        result.name = 'vue';
      } else if (allDeps['vite']) {
        result.name = 'vite';
      } else if (allDeps['react']) {
        result.name = 'react';
      }

      // Styling detection
      if (allDeps['tailwindcss']) result.styling = 'tailwind';
      else if (existsSync(join(dir, 'styled-components')) || allDeps['styled-components']) result.styling = 'styled-components';
      else if (allDeps['@emotion/styled']) result.styling = 'emotion';

      // Store dev script for auto-start
      result.devScript = pkg.scripts?.dev || pkg.scripts?.start;

    } catch {}
  }

  // Python frameworks
  if (existsSync(join(dir, 'manage.py'))) result.name = 'django';
  else if (existsSync(join(dir, 'requirements.txt'))) {
    try {
      const reqs = readFileSync(join(dir, 'requirements.txt'), 'utf-8');
      if (reqs.includes('flask')) result.name = 'flask';
      if (reqs.includes('fastapi')) result.name = 'fastapi';
    } catch {}
  }

  // Ruby
  if (existsSync(join(dir, 'Gemfile'))) {
    try {
      const gemfile = readFileSync(join(dir, 'Gemfile'), 'utf-8');
      if (gemfile.includes('rails')) result.name = 'rails';
      if (gemfile.includes('sinatra')) result.name = 'sinatra';
    } catch {}
  }

  // PHP
  if (existsSync(join(dir, 'composer.json'))) {
    try {
      const composer = JSON.parse(readFileSync(join(dir, 'composer.json'), 'utf-8'));
      if (composer.require?.['laravel/framework']) result.name = 'laravel';
    } catch {}
  }

  // Go
  if (existsSync(join(dir, 'go.mod'))) result.name = 'go';

  // Static HTML
  if (result.name === 'unknown' && existsSync(join(dir, 'index.html'))) {
    result.name = 'static';
  }

  return result;
}

export async function findAvailablePort(start = 4444) {
  const detectPort = (await import('detect-port')).default;
  return detectPort(start);
}
