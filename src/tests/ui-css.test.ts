import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve('src/ui/styles.css'), 'utf8');

describe('extension UI CSS', () => {
  it('sets Persian-first UI surfaces to RTL and right-aligned text', () => {
    expect(css).toMatch(/\.ibnav-root\s*\{[\s\S]*direction:\s*rtl;[\s\S]*text-align:\s*right;/);
    expect(css).toMatch(/\.ibnav-widget\s*\{[\s\S]*text-align:\s*right;/);
    expect(css).toMatch(/\.ibnav-popup\s*\{[\s\S]*text-align:\s*right;/);
    expect(css).toMatch(/\.ibnav-diagnostics\s*\{[\s\S]*direction:\s*rtl;[\s\S]*text-align:\s*right;/);
  });

  it('contains long diagnostics inside the widget instead of widening the page', () => {
    expect(css).toContain('overflow-wrap: anywhere');
    expect(css).toContain('word-break: break-word');
    expect(css).toMatch(/\.ibnav-widget\s*\{[\s\S]*overflow-x:\s*hidden;/);
    expect(css).toMatch(/\.ibnav-preview-code\s*\{[\s\S]*max-width:\s*100%;[\s\S]*white-space:\s*pre-wrap;/);
    expect(css).toMatch(/\.ibnav-table-preview\s*\{[\s\S]*overflow-x:\s*auto;/);
  });

  it('keeps numeric and copy/debug entry surfaces readable in LTR', () => {
    expect(css).toMatch(/\.ibnav-input\s*\{[\s\S]*direction:\s*ltr;[\s\S]*text-align:\s*left;[\s\S]*unicode-bidi:\s*plaintext;/);
    expect(css).toMatch(/\.ibnav-copy-textarea\s*\{[\s\S]*direction:\s*ltr;[\s\S]*text-align:\s*left;[\s\S]*unicode-bidi:\s*plaintext;/);
    expect(css).toMatch(/\.ibnav-link\s*\{[\s\S]*direction:\s*ltr;[\s\S]*unicode-bidi:\s*plaintext;/);
  });
});
