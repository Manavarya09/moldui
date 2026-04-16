export function buildSyncPrompt(changes, framework, sourceHints) {
  const lines = [];

  lines.push('The user visually edited their running web app using moldui. Translate these DOM changes into source code edits.');
  lines.push('');
  lines.push(`Framework: ${formatFramework(framework)}`);
  lines.push(`Styling: ${framework.styling}`);
  lines.push('');

  if (sourceHints.length > 0) {
    lines.push('Likely source files:');
    for (const hint of sourceHints) {
      lines.push(`  - ${hint.file} (${hint.reason})`);
    }
    lines.push('');
  }

  lines.push(`Changes (${changes.length}):`);
  lines.push('');

  for (let i = 0; i < changes.length; i++) {
    const c = changes[i];
    lines.push(`${i + 1}. [${c.type}] ${describeElement(c)}`);

    switch (c.type) {
      case 'style':
        for (const [prop, val] of Object.entries(c.changes)) {
          const hint = framework.styling === 'tailwind' ? ` (Tailwind: ${cssPropToTailwind(prop, val.to)})` : '';
          lines.push(`   ${prop}: ${val.from} -> ${val.to}${hint}`);
        }
        break;
      case 'text':
        lines.push(`   "${c.oldText}" -> "${c.newText}"`);
        break;
      case 'reorder':
        lines.push(`   Moved from index ${c.fromIndex} to ${c.toIndex} among ${c.siblingCount} siblings`);
        break;
      case 'position':
        lines.push(`   Position: ${JSON.stringify(c.position)}`);
        break;
      case 'insert':
        lines.push(`   Added <${c.tag}> at index ${c.index} inside ${c.parentSelector}`);
        break;
      case 'clone':
        lines.push(`   Duplicated, inserted at index ${c.index}`);
        break;
      case 'delete':
        lines.push(`   Deleted element`);
        break;
      case 'wrap':
        lines.push(`   Wrapped in <${c.wrapperTag || 'div'}>`);
        break;
      case 'image':
        lines.push(`   Image src: ${(c.oldSrc || '').slice(0, 60)} -> ${(c.newSrc || '').slice(0, 60)}`);
        break;
      case 'chat':
        lines.push(`   User prompt: "${c.prompt}"`);
        break;
    }
    lines.push('');
  }

  lines.push('Instructions:');
  lines.push('- Read the source file(s), find the corresponding elements, and make MINIMAL edits');
  lines.push('- Preserve existing code style and formatting');
  lines.push('- For Tailwind: update class names. For CSS: update the stylesheet or scoped styles.');
  lines.push('- For text changes: update the string literal or text node');
  lines.push('- For reorder: move the JSX/HTML element to the new position');

  return lines.join('\n');
}

function formatFramework(fw) {
  const names = {
    nextjs: 'Next.js', nuxt: 'Nuxt', angular: 'Angular', sveltekit: 'SvelteKit',
    svelte: 'Svelte', vue: 'Vue', vite: 'Vite + React', react: 'React',
    django: 'Django', rails: 'Ruby on Rails', flask: 'Flask', fastapi: 'FastAPI',
    laravel: 'Laravel', go: 'Go', static: 'Static HTML/CSS', unknown: 'Unknown',
  };
  return names[fw.name] || fw.name;
}

function describeElement(change) {
  const parts = [];
  if (change.element?.tag) parts.push(change.element.tag);
  if (change.element?.id) parts.push(`#${change.element.id}`);
  if (change.element?.classes?.length) parts.push(`.${change.element.classes.filter(c => c).slice(0, 2).join('.')}`);
  if (change.selector) parts.push(`(${change.selector})`);
  return parts.join('') || 'element';
}

// Simple CSS property -> Tailwind class hint
function cssPropToTailwind(prop, value) {
  const pxVal = parseInt(value);
  const map = {
    padding: `p-${pxVal / 4}`,
    paddingTop: `pt-${pxVal / 4}`,
    paddingRight: `pr-${pxVal / 4}`,
    paddingBottom: `pb-${pxVal / 4}`,
    paddingLeft: `pl-${pxVal / 4}`,
    margin: `m-${pxVal / 4}`,
    marginTop: `mt-${pxVal / 4}`,
    marginRight: `mr-${pxVal / 4}`,
    marginBottom: `mb-${pxVal / 4}`,
    marginLeft: `ml-${pxVal / 4}`,
    gap: `gap-${pxVal / 4}`,
    borderRadius: `rounded-${pxVal <= 2 ? 'sm' : pxVal <= 4 ? '' : pxVal <= 8 ? 'md' : pxVal <= 12 ? 'lg' : pxVal <= 16 ? 'xl' : '2xl'}`,
    fontSize: `text-${pxVal <= 12 ? 'xs' : pxVal <= 14 ? 'sm' : pxVal <= 16 ? 'base' : pxVal <= 18 ? 'lg' : pxVal <= 20 ? 'xl' : '2xl'}`,
    width: `w-[${value}]`,
    height: `h-[${value}]`,
  };
  return map[prop] || `[${value}]`;
}

export function buildUndoPrompt(change, framework) {
  return `Revert the following visual change that was previously applied:\n\n${JSON.stringify(change, null, 2)}\n\nRevert to original values. Framework: ${formatFramework(framework)}`;
}
