import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

// Map a DOM element description to likely source files
export function mapElementToSource(element, framework, projectDir) {
  const hints = [];

  // 1. Route-based mapping
  const routeFile = findRouteFile(element.url || '/', framework, projectDir);
  if (routeFile) hints.push({ file: routeFile, confidence: 0.8, reason: 'route match' });

  // 2. Class name search (most reliable for Tailwind/CSS)
  if (element.classes?.length > 0) {
    const uniqueClass = element.classes.find(c => !isUtilityClass(c));
    if (uniqueClass) {
      const files = grepProject(projectDir, uniqueClass, ['.tsx', '.jsx', '.vue', '.svelte', '.html', '.erb', '.blade.php', '.twig', '.py', '.templ']);
      for (const f of files.slice(0, 3)) {
        hints.push({ file: f, confidence: 0.7, reason: `contains class "${uniqueClass}"` });
      }
    }
  }

  // 3. ID search
  if (element.id) {
    const files = grepProject(projectDir, element.id, ['.tsx', '.jsx', '.vue', '.svelte', '.html']);
    for (const f of files.slice(0, 2)) {
      hints.push({ file: f, confidence: 0.9, reason: `contains id="${element.id}"` });
    }
  }

  // 4. Text content search (for text edits)
  if (element.textContent && element.textContent.length > 5 && element.textContent.length < 100) {
    const escaped = element.textContent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const files = grepProject(projectDir, escaped, ['.tsx', '.jsx', '.vue', '.svelte', '.html', '.erb', '.blade.php', '.py']);
    for (const f of files.slice(0, 2)) {
      hints.push({ file: f, confidence: 0.85, reason: `contains text "${element.textContent.slice(0, 30)}..."` });
    }
  }

  // Deduplicate and sort by confidence
  const seen = new Set();
  return hints.filter(h => {
    if (seen.has(h.file)) return false;
    seen.add(h.file);
    return true;
  }).sort((a, b) => b.confidence - a.confidence);
}

function findRouteFile(urlPath, framework, dir) {
  const path = urlPath === '/' ? '' : urlPath;

  const candidates = {
    nextjs: [
      `app${path}/page.tsx`, `app${path}/page.jsx`, `app${path}/page.js`,
      `src/app${path}/page.tsx`, `src/app${path}/page.jsx`,
      `pages${path}/index.tsx`, `pages${path}/index.jsx`, `pages${path}.tsx`,
      `src/pages${path}/index.tsx`,
    ],
    nuxt: [`pages${path}/index.vue`, `pages${path}.vue`],
    sveltekit: [`src/routes${path}/+page.svelte`],
    angular: [`src/app${path}/${path.split('/').pop() || 'app'}.component.ts`],
    vue: [`src/views${path}.vue`, `src/pages${path}.vue`, `src/views${path}/index.vue`],
    django: [`templates${path}.html`, `templates${path}/index.html`],
    rails: [`app/views${path}/index.html.erb`],
    laravel: [`resources/views${path}.blade.php`, `resources/views${path}/index.blade.php`],
    static: [`${path}/index.html`, `${path}.html`, 'index.html'],
  };

  const frameworkCandidates = candidates[framework.name] || candidates.static;
  for (const candidate of frameworkCandidates) {
    const full = join(dir, candidate);
    if (existsSync(full)) return relative(dir, full);
  }
  return null;
}

function isUtilityClass(cls) {
  // Tailwind/utility patterns
  return /^(p|m|w|h|flex|grid|text|bg|border|rounded|shadow|gap|space|font|leading|tracking|opacity|z|top|right|bottom|left|absolute|relative|fixed|sticky|hidden|block|inline|overflow)-/.test(cls)
    || /^(sm|md|lg|xl|2xl):/.test(cls)
    || /^(hover|focus|active|disabled):/.test(cls);
}

function grepProject(dir, pattern, extensions) {
  const results = [];
  const ignore = ['node_modules', '.next', '.nuxt', '.svelte-kit', 'dist', 'build', '.git', '__pycache__', 'vendor'];

  function walk(current) {
    if (results.length >= 10) return;
    try {
      const entries = readdirSync(current);
      for (const entry of entries) {
        if (ignore.includes(entry)) continue;
        const full = join(current, entry);
        try {
          const stat = statSync(full);
          if (stat.isDirectory()) {
            walk(full);
          } else if (extensions.some(ext => entry.endsWith(ext))) {
            try {
              const content = readFileSync(full, 'utf-8');
              if (content.includes(pattern)) {
                results.push(relative(dir, full));
              }
            } catch {}
          }
        } catch {}
      }
    } catch {}
  }

  walk(dir);
  return results;
}
