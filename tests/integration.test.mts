import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';

const ROOT = new URL('../', import.meta.url).pathname;
const FIXTURES = join(ROOT, 'tests', 'fixtures');
const CLI = join(ROOT, 'dist', 'cli.js');
function run(...args: string[]) {
  const result = spawnSync(process.execPath, [CLI, ...args], {encoding: 'utf8', cwd: ROOT});
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test('three native adapters analyze, validate, packet, and export offline HTML', () => {
  const dir = mkdtempSync(join(tmpdir(), 'session-integration-'));
  const dbPath = join(dir, 'state.db');
  const fixture = JSON.parse(readFileSync(join(FIXTURES, 'hermes.sanitized-real.json'), 'utf8'));
  const db = new DatabaseSync(dbPath);
  for (const [table, rows] of [['sessions', [fixture.session]], ['messages', fixture.messages]] as const) {
    const columns = [...new Set(rows.flatMap((row: Record<string, unknown>) => Object.keys(row)))].sort();
    db.exec(`CREATE TABLE ${table} (${columns.join(', ')})`);
    const statement = db.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`);
    for (const row of rows) statement.run(...columns.map(key => row[key] ?? null));
  }
  db.close();
  const reportPath = join(dir, 'report.json');
  const packetPath = join(dir, 'packet.json');
  const htmlPath = join(dir, 'report.html');
  run('analyze', join(FIXTURES, 'claude_code.sanitized-real.jsonl'), join(FIXTURES, 'codex.sanitized-real.jsonl'), dbPath, '-o', reportPath);
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  assert.deepEqual(new Set(report.sessions.map((item: {agent: string}) => item.agent)), new Set(['claude_code', 'codex', 'hermes']));
  assert.equal(report.summary.session_count, 3);
  assert.equal(report.privacy.excerpts_included, false);
  run('validate', reportPath);
  run('packet', reportPath, '-o', packetPath, '--max-chars', '80');
  assert.ok(statSync(packetPath).size <= 80);
  run('export', reportPath, '-o', htmlPath);
  const html = readFileSync(htmlPath, 'utf8');
  assert.equal(html.match(/id="embedded-report"/g)?.length, 1);
  assert.doesNotMatch(html, /src="app.js"|href="style.css"/);
  assert.match(html, /id="report-file"/);
});
