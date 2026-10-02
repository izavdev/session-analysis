import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

test('Pages artifact excludes stale reports and resolves assets and navigation under repository paths', () => {
  const builder = fileURLToPath(new URL('../scripts/build-pages.mjs', import.meta.url));
  const site = new URL('../_site/', import.meta.url);
  execFileSync(process.execPath, [builder]);
  writeFileSync(new URL('private-report.json', site), '{"private":true}');
  execFileSync(process.execPath, [builder]);
  const files = readdirSync(site).sort();
  assert.deepEqual(files, ['.nojekyll', 'app.js', 'index.html', 'setup.html', 'style.css']);
  for (const base of ['https://example.github.io/session-analysis/', 'https://reports.example.com/']) {
    for (const page of ['index.html', 'setup.html']) {
      const html = readFileSync(new URL(page, site), 'utf8');
      for (const [, reference] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
        if (reference.startsWith('https://') || reference.startsWith('#')) continue;
        const resolved = new URL(reference, new URL(page, base));
        assert.ok(resolved.href.startsWith(base), `${reference} must stay under ${base}`);
        assert.ok(files.includes(resolved.href.slice(base.length)), `${reference} must exist in the artifact`);
      }
    }
  }
  const script = readFileSync(new URL('app.js', site), 'utf8');
  assert.doesNotMatch(script, /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/);
  assert.doesNotMatch(script, /\b(?:localStorage|sessionStorage|indexedDB)\b/);
});
