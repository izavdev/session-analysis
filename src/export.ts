import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Bundle the trusted viewer around untrusted report data without network requests. */
export function renderHtml(report: unknown, assetsDir = join(ROOT, 'web')): string {
  let html = readFileSync(join(assetsDir, 'index.html'), 'utf8');
  const css = readFileSync(join(assetsDir, 'style.css'), 'utf8');
  const js = readFileSync(join(assetsDir, 'app.js'), 'utf8');
  const payload = JSON.stringify(report).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const embedded = `<script id="embedded-report" type="application/json">${payload}</script>`;
  let styles = 0;
  html = html.replace(/<link\b[^>]*href=["'](?:\.\/)?style\.css["'][^>]*>/gi, () => {
    styles++;
    return `<style>${css}</style>`;
  });
  let placeholders = 0;
  html = html.replace(/<script id="embedded-report" type="application\/json">\s*<\/script>/gi, () => {
    placeholders++;
    return embedded;
  });
  let scripts = 0;
  html = html.replace(/<script\b[^>]*src=["'](?:\.\/)?app\.js["'][^>]*>\s*<\/script>/gi, () => {
    scripts++;
    return `${placeholders ? '' : embedded + '\n'}<script>${js}</script>`;
  });
  if (styles !== 1 || scripts !== 1 || placeholders > 1) {
    throw new Error('Viewer template must contain exactly one style.css and app.js and at most one report placeholder');
  }
  return html;
}
