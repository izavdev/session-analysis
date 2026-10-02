import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {renderHtml} from '../dist/export.js';

test('offline export inlines assets once and safely embeds JSON', () => {
  const root = mkdtempSync(join(tmpdir(), 'session-export-'));
  mkdirSync(join(root, 'web'));
  writeFileSync(join(root, 'web', 'index.html'), '<html><head><link rel="stylesheet" href="style.css"><script id="embedded-report" type="application/json"></script><script defer src="app.js"></script></head><body></body></html>');
  writeFileSync(join(root, 'web', 'style.css'), 'body { color: white; }');
  writeFileSync(join(root, 'web', 'app.js'), 'window.viewerLoaded = true;');
  const payload = {text: '</script><script>alert(1)</script>\u2028\u2029'};
  const html = renderHtml(payload, join(root, 'web'));
  assert.equal(html.match(/id="embedded-report"/g)?.length, 1);
  assert.match(html, /window.viewerLoaded = true/);
  assert.match(html, /body \{ color: white; \}/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(html, /src="app.js"|href="style.css"/);
  assert.doesNotMatch(html, /<script type="module">/);
  const embedded = html.match(/<script id="embedded-report" type="application\/json">([^<]+)<\/script>/)?.[1];
  assert.deepEqual(JSON.parse(embedded!), payload);
});
