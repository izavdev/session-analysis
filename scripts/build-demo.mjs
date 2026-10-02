import { readFileSync, writeFileSync } from 'node:fs';

// Bundle only the curated public example; never discover or import local logs.
const source = readFileSync(new URL('../web/examples/codex-pages-session.jsonl', import.meta.url), 'utf8');
writeFileSync(new URL('../src/web/demo-source.json', import.meta.url), JSON.stringify(source) + '\n');
