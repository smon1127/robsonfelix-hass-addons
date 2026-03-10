const http = require('http');
const fs = require('fs');
const path = require('path');
const httpProxy = require('http-proxy');

const target = 'http://127.0.0.1:7682';
const overlayPath = path.join(__dirname, 'overlay.js');

const proxy = httpProxy.createProxyServer({
  target,
  ws: true,
  xfwd: true,
  selfHandleResponse: true,
});

proxy.on('proxyRes', (proxyRes, req, res) => {
  const contentType = String(proxyRes.headers['content-type'] || '');
  if (!contentType.includes('text/html')) {
    res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
    proxyRes.pipe(res);
    return;
  }

  const chunks = [];
  proxyRes.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
  proxyRes.on('end', () => {
    let body = Buffer.concat(chunks).toString('utf8');
    const scriptTag = '<script src="overlay.js"></script>';
    if (body.includes('</body>')) {
      body = body.replace('</body>', `${scriptTag}</body>`);
    } else {
      body += scriptTag;
    }

    const headers = { ...proxyRes.headers };
    delete headers['content-length'];
    res.writeHead(proxyRes.statusCode || 200, headers);
    res.end(body);
  });
});

proxy.on('error', (err, req, res) => {
  if (res && !res.headersSent) {
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
  }
  if (res) {
    res.end(`Proxy error: ${err.message}`);
  }
});

const server = http.createServer((req, res) => {
  if (req.url === '/overlay.js') {
    res.writeHead(200, {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(overlayPath).pipe(res);
    return;
  }

  proxy.web(req, res);
});

server.on('upgrade', (req, socket, head) => {
  proxy.ws(req, socket, head);
});

server.listen(7681, '0.0.0.0', () => {
  console.log('[INFO] Claude Code ingress proxy listening on :7681');
});
