import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const output = fileURLToPath(new URL('../_site/', import.meta.url));
// Recreate the site; only viewer assets and the two explicitly curated demo files are published.
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
for (const asset of ['index.html', 'setup.html', 'style.css', 'app.js']) {
  copyFileSync(new URL(`../web/${asset}`, import.meta.url), `${output}/${asset}`);
}
mkdirSync(`${output}/examples`, { recursive: true });
for (const asset of ['codex-pages-report.json', 'codex-pages-session.jsonl']) {
  copyFileSync(new URL(`../web/examples/${asset}`, import.meta.url), `${output}/examples/${asset}`);
}
writeFileSync(`${output}/.nojekyll`, '');
console.log('Static viewer built in _site/');
