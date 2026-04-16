import http from 'http';
import httpProxy from 'http-proxy';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function createProxy(targetPort, proxyPort, wsPort) {
  const proxy = httpProxy.createProxyServer({ target: `http://localhost:${targetPort}`, ws: true });

  // Serve editor assets from /__clayui__/*
  const editorDir = join(__dirname, 'inject');

  const server = http.createServer((req, res) => {
    // Serve editor assets
    if (req.url.startsWith('/__clayui__/')) {
      const filename = req.url.replace('/__clayui__/', '');
      const filepath = join(editorDir, filename);
      if (existsSync(filepath)) {
        const ext = filename.split('.').pop();
        const types = { js: 'application/javascript', css: 'text/css', html: 'text/html' };
        res.writeHead(200, { 'Content-Type': types[ext] || 'text/plain', 'Cache-Control': 'no-store' });
        res.end(readFileSync(filepath));
        return;
      }
    }

    // Strip accept-encoding so the dev server sends uncompressed HTML.
    // This avoids needing to decompress gzip/br before injecting our script.
    delete req.headers['accept-encoding'];

    // Intercept HTML responses to inject editor script
    const _writeHead = res.writeHead;
    const _write = res.write;
    const _end = res.end;
    let isHtml = false;
    let body = [];

    res.writeHead = function(code, headers) {
      // Check content type
      const ct = headers?.['content-type'] || this.getHeader?.('content-type') || '';
      if (typeof ct === 'string' && ct.includes('text/html')) {
        isHtml = true;
        // Remove content-length since we'll modify the body
        if (headers && typeof headers === 'object') delete headers['content-length'];
        this.removeHeader('content-length');
        // Remove content-encoding in case the server still compressed
        this.removeHeader('content-encoding');
      }
      return _writeHead.apply(this, arguments);
    };

    res.write = function(chunk) {
      if (isHtml) {
        body.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        return true;
      }
      return _write.apply(this, arguments);
    };

    res.end = function(chunk) {
      if (isHtml) {
        if (chunk) body.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        let html = Buffer.concat(body).toString('utf-8');

        // Inject editor script before </body> or at end
        const injectScript = `
<script>window.__CLAYUI_WS_PORT__=${wsPort};</script>
<script src="/__clayui__/editor.js"></script>
`;
        if (html.includes('</body>')) {
          html = html.replace('</body>', injectScript + '</body>');
        } else if (html.includes('</html>')) {
          html = html.replace('</html>', injectScript + '</html>');
        } else {
          html += injectScript;
        }

        return _end.call(this, html, 'utf-8');
      }
      return _end.apply(this, arguments);
    };

    // Proxy the request
    proxy.web(req, res, {}, (err) => {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('clayui proxy error: ' + err.message);
    });
  });

  // Handle WebSocket upgrades (for HMR)
  server.on('upgrade', (req, socket, head) => {
    // Don't proxy our own WebSocket path
    if (req.url === '/__clayui_ws__') return;
    proxy.ws(req, socket, head);
  });

  // Handle proxy errors gracefully
  proxy.on('error', (err, req, res) => {
    if (res.writeHead) {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('Dev server unavailable: ' + err.message);
    }
  });

  return { server, proxy };
}
