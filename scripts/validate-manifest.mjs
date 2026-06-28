import { access, readFile, readdir } from 'node:fs/promises';
import { join, posix, resolve } from 'node:path';

const distDir = resolve('dist');
const manifestPath = resolve(distDir, 'manifest.json');
const moduleSyntaxPattern = /(^|\n)\s*(import\s+[\s\S]*?\s+from\s*["']|import\s*["']|export\s+)/;

function isUnsafePath(value) {
  return (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.startsWith('/') ||
    /^[A-Za-z]:[\\/]/.test(value) ||
    value.split(/[\\/]/).includes('..')
  );
}

async function exists(relativePath) {
  await access(resolve(distDir, relativePath));
}

async function listFiles(dir, base = '') {
  const entries = await readdir(resolve(dir, base), { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const relativePath = base ? posix.join(base, entry.name) : entry.name;
    if (entry.isDirectory()) {
      files.push(...(await listFiles(dir, relativePath)));
    } else {
      files.push(relativePath);
    }
  }

  return files;
}

function globToRegExp(pattern) {
  const doubleStar = '__DOUBLE_STAR__';
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, doubleStar)
    .replace(/\*/g, '[^/]*')
    .replaceAll(doubleStar, '.*');
  return new RegExp(`^${escaped}$`);
}

async function validatePath(relativePath, failures, label, allFiles) {
  if (isUnsafePath(relativePath)) {
    failures.push(`${label} uses an unsafe or empty path: ${relativePath}`);
    return;
  }

  if (relativePath.includes('*')) {
    const matcher = globToRegExp(relativePath);
    if (!allFiles.some((file) => matcher.test(file))) {
      failures.push(`${label} glob does not match any dist file: ${relativePath}`);
    }
    return;
  }

  try {
    await exists(relativePath);
  } catch {
    failures.push(`${label} file does not exist in dist: ${relativePath}`);
  }
}

function collectManifestPaths(manifest) {
  const paths = [];

  if (manifest.background?.service_worker) {
    paths.push(['background.service_worker', manifest.background.service_worker]);
  }

  if (manifest.action?.default_popup) {
    paths.push(['action.default_popup', manifest.action.default_popup]);
  }

  for (const [size, iconPath] of Object.entries(manifest.icons ?? {})) {
    paths.push([`icons.${size}`, iconPath]);
  }

  for (const [index, script] of (manifest.content_scripts ?? []).entries()) {
    for (const [jsIndex, jsPath] of (script.js ?? []).entries()) {
      paths.push([`content_scripts[${index}].js[${jsIndex}]`, jsPath]);
    }
    for (const [cssIndex, cssPath] of (script.css ?? []).entries()) {
      paths.push([`content_scripts[${index}].css[${cssIndex}]`, cssPath]);
    }
  }

  for (const [index, resourceGroup] of (manifest.web_accessible_resources ?? []).entries()) {
    for (const [resourceIndex, resourcePath] of (resourceGroup.resources ?? []).entries()) {
      paths.push([`web_accessible_resources[${index}].resources[${resourceIndex}]`, resourcePath]);
    }
  }

  return paths;
}

const manifest = JSON.parse((await readFile(manifestPath, 'utf8')).replace(/^\uFEFF/, ''));
const failures = [];
const allFiles = await listFiles(distDir);

if (manifest.default_locale) {
  try {
    await exists(join('_locales', manifest.default_locale, 'messages.json'));
  } catch {
    failures.push(`default_locale is set to ${manifest.default_locale}, but _locales/${manifest.default_locale}/messages.json is missing.`);
  }
}

for (const [label, relativePath] of collectManifestPaths(manifest)) {
  await validatePath(relativePath, failures, label, allFiles);
}

for (const [index, script] of (manifest.content_scripts ?? []).entries()) {
  for (const [jsIndex, jsPath] of (script.js ?? []).entries()) {
    if (isUnsafePath(jsPath) || jsPath.includes('*')) {
      continue;
    }
    try {
      const source = await readFile(resolve(distDir, jsPath), 'utf8');
      if (moduleSyntaxPattern.test(source)) {
        failures.push(`content_scripts[${index}].js[${jsIndex}] contains top-level module syntax: ${jsPath}`);
      }
    } catch {
      // Missing files are already reported above.
    }
  }
}

if (failures.length > 0) {
  throw new Error(`Invalid Chrome extension dist manifest:\n${failures.join('\n')}`);
}

console.log('Manifest validation passed.');
