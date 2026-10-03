import { readFileSync, writeFileSync } from 'node:fs';

const version = readFileSync(new URL('../VERSION', import.meta.url), 'utf8').trim();
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error('VERSION must contain a version such as 0.2.0 or 0.3.0-beta.1.');
}

const page = new URL('../web/index.html', import.meta.url);
const html = readFileSync(page, 'utf8');
const marker = /(<span class="version">)[^<]*(<\/span>)/;
if (!marker.test(html)) throw new Error('Viewer version element is missing.');
const updated = html.replace(marker, `$1/ ${version}$2`);
if (updated !== html) writeFileSync(page, updated);
