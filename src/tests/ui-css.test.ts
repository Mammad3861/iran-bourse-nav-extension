import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve('src/ui/styles.css'), 'utf8');

describe('extension UI CSS', () => {
  it('contains long diagnostics inside the widget instead of widening the page', () => {
    expect(css).toContain('overflow-wrap: anywhere');
    expect(css).toContain('word-break: break-word');
    expect(css).toMatch(/\.ibnav-widget\s*\{[\s\S]*overflow-x:\s*hidden;/);
    expect(css).toMatch(/\.ibnav-preview-code\s*\{[\s\S]*max-width:\s*100%;[\s\S]*white-space:\s*pre-wrap;/);
    expect(css).toMatch(/\.ibnav-table-preview\s*\{[\s\S]*overflow-x:\s*auto;/);
  });
});
