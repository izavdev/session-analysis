import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';

const port = Number(process.argv[2] ?? 8000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('Port must be an integer from 1 to 65535.');
  process.exit(1);
}

const assets = new Map([
  ['index.html', 'text/html'],
  ['setup.html', 'text/html'],
  ['style.css', 'text/css'],
  ['app.js', 'text/javascript'],
  ['examples/codex-pages-report.json', 'application/json'],
  ['examples/codex-pages-session.jsonl', 'application/x-ndjson'],
]);

const server = createServer(async (request, response) => {
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  const path = new URL(request.url, 'http://localhost').pathname;
  const asset = path === '/' ? 'index.html' : path.slice(1);
  const contentType = assets.get(asset);
  if (!contentType) {
    response.writeHead(404).end('Not found');
    return;
  }
  try {
    const content = await readFile(new URL(`../_site/${asset}`, import.meta.url));
    response.writeHead(200, { 'Content-Type': `${contentType}; charset=utf-8`, 'Cache-Control': 'no-store' });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch (error) {
    response.writeHead(error.code === 'ENOENT' ? 404 : 500).end('Unable to serve asset');
  }
});

server.on('error', error => {
  console.error(`Preview server: ${error.message}`);
  process.exit(1);
});
server.listen(port, '127.0.0.1', () => {
  console.log(`Local preview: http://127.0.0.1:${port}/ (Ctrl+C to stop)`);
});
