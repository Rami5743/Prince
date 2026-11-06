/** Static server for local development and for the browser tests. */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';

const ROOT = process.argv[3] ? process.argv[3] : process.cwd();
const PORT = Number(process.argv[2] ?? 8099);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.dat': 'application/octet-stream',
  '.DAT': 'application/octet-stream',
};

export function serve(port = PORT, root = ROOT) {
  const server = createServer(async (req, res) => {
    try {
      let p = decodeURIComponent((req.url ?? '/').split('?')[0]);
      if (p.endsWith('/')) p += 'index.html';
      const file = join(root, normalize(p).replace(/^(\.\.[/\\])+/, ''));
      const body = await readFile(file);
      res.writeHead(200, {
        'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await serve();
  console.log(`serving ${ROOT} on http://localhost:${PORT}/web/`);
}
