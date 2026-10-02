import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const output = fileURLToPath(new URL('../_site/', import.meta.url));
// Recreate only the generated site directory; never copy reports or source logs.
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
for (const asset of ['index.html', 'setup.html', 'style.css', 'app.js']) {
  copyFileSync(new URL(`../web/${asset}`, import.meta.url), `${output}/${asset}`);
}
writeFileSync(`${output}/.nojekyll`, '');
console.log('Static viewer built in _site/');
