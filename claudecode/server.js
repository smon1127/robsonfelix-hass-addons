const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');

const TTYD_HOST = '127.0.0.1';
const TTYD_PORT = 7682;
const overlayPath = path.join(__dirname, 'overlay.js');

const server = http.createServer((req, res) => {
  // Serve overlay.js directly
  if (req.url === '/overlay.js') {
    res.writeHead(200, {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(overlayPath).pipe(res);
    return;
  }

  // Proxy HTTP to ttyd, inject script tag on HTML responses
  // Remove accept-encoding so ttyd returns uncompressed HTML (avoids gzip handling)
  const fwdHeaders = { ...req.headers };
  delete fwdHeaders['accept-encoding'];
  const proxyReq = http.request(
    { host: TTYD_HOST, port: TTYD_PORT, path: req.url, method: req.method, headers: fwdHeaders },
    (proxyRes) => {
      const ct = String(proxyRes.headers['content-type'] || '');
      if (!ct.includes('text/html')) {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
        return;
      }
      // Buffer HTML, inject overlay script
      const chunks = [];
      proxyRes.on('data', (c) => chunks.push(c));
      proxyRes.on('end', () => {
        let html = Buffer.concat(chunks).toString('utf8');
        html = html.replace('</body>', '<script src="overlay.js"></script></body>');
        const headers = { ...proxyRes.headers };
        delete headers['content-length'];
        res.writeHead(proxyRes.statusCode, headers);
        res.end(html);
      });
    }
  );
  proxyReq.on('error', (err) => {
    if (!res.headersSent) res.writeHead(502);
    res.end('Proxy error: ' + err.message);
  });
  req.pipe(proxyReq);
});

// WebSocket: raw TCP passthrough (no library needed)
server.on('upgrade', (req, socket, head) => {
  const proxy = net.connect(TTYD_PORT, TTYD_HOST, () => {
    // Reconstruct the HTTP upgrade request and forward it raw
    let reqLine = req.method + ' ' + req.url + ' HTTP/' + req.httpVersion + '\r\n';
    const hdrs = req.rawHeaders;
    for (let i = 0; i < hdrs.length; i += 2) {
      reqLine += hdrs[i] + ': ' + hdrs[i + 1] + '\r\n';
    }
    reqLine += '\r\n';
    proxy.write(reqLine);
    if (head && head.length) proxy.write(head);
    socket.pipe(proxy).pipe(socket);
  });
  proxy.on('error', () => socket.destroy());
  socket.on('error', () => proxy.destroy());
});

server.listen(7681, '0.0.0.0', () => {
  console.log('[INFO] Claude Code ingress proxy listening on :7681');
});
