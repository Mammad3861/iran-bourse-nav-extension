import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const contentScripts = ['dist/content/tsetmc-content.js', 'dist/content/codal-content.js'];
const moduleSyntaxPattern = /(^|\n)\s*(import\s+[\s\S]*?\s+from\s*["']|import\s*["']|export\s+)/;

const failures = [];

for (const file of contentScripts) {
  const fullPath = resolve(file);
  const source = await readFile(fullPath, 'utf8');

  if (moduleSyntaxPattern.test(source)) {
    failures.push(`${file} contains top-level module syntax.`);
  }
}

if (failures.length > 0) {
  throw new Error(`Invalid MV3 classic content script output:\n${failures.join('\n')}`);
}

console.log('Content script output validation passed.');
