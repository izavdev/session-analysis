import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const cli = new URL('../dist/cli.js', import.meta.url).pathname;
const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], {encoding: 'utf8'});

test('CLI exposes all local workflow commands', () => {
  const result = run('--help');
  assert.equal(result.status, 0, result.stderr);
  for (const name of ['discover', 'analyze', 'validate', 'packet', 'merge', 'export']) assert.match(result.stdout, new RegExp(name));
});

test('missing report produces concise error, not a stack trace', () => {
  const result = run('validate', '/nonexistent/session-analysis-report.json');
  assert.equal(result.status, 2);
  assert.match(result.stderr, /error:/);
  assert.doesNotMatch(result.stderr, / at |Error:|Stack/);
});

test('directory import cannot write over its own source file', () => {
  const directory = mkdtempSync(join(tmpdir(), 'session-cli-'));
  const input = join(directory, 'session.jsonl');
  const original = readFileSync(new URL('./fixtures/codex.sanitized-real.jsonl', import.meta.url));
  writeFileSync(input, original);
  const result = run('analyze', directory, '-o', input);
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /input directory/);
  assert.deepEqual(readFileSync(input), original);
});

test('directory import cannot write into nested new directories through a symlink', () => {
  const root = mkdtempSync(join(tmpdir(), 'session-cli-link-'));
  const directory = join(root, 'input');
  mkdirSync(directory);
  writeFileSync(join(directory, 'session.jsonl'), readFileSync(new URL('./fixtures/codex.sanitized-real.jsonl', import.meta.url)));
  const alias = join(root, 'alias');
  symlinkSync(directory, alias, 'dir');
  const output = join(alias, 'new', 'nested', 'report.json');
  const result = run('analyze', directory, '-o', output);
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /input directory/);
  assert.equal(existsSync(output), false);
});
