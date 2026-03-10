const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');

const TTYD_HOST = '127.0.0.1';
const TTYD_PORT = 7682;
const overlayPath = path.join(__dirname, 'overlay.js');

const SUPERVISOR_TOKEN = process.env.SUPERVISOR_TOKEN || '';

// Helper: call Supervisor API
function supervisorAPI(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      host: 'supervisor', port: 80, path: apiPath, method,
      headers: {
        'Authorization': 'Bearer ' + SUPERVISOR_TOKEN,
        'Content-Type': 'application/json',
      },
    };
    const req = http.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        console.log('[API] ' + method + ' ' + apiPath + ' -> ' + res.statusCode + ': ' + raw.substring(0, 200));
        try { resolve(JSON.parse(raw)); }
        catch (e) { resolve({ result: 'ok' }); }
      });
    });
    req.on('error', (err) => {
      console.log('[API] ' + method + ' ' + apiPath + ' ERROR: ' + err.message);
      reject(err);
    });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

const server = http.createServer((req, res) => {
  // API: refresh repos and update add-on
  if (req.url === '/api/refresh-update') {
    res.setHeader('Content-Type', 'application/json');
    (async () => {
      try {
        // 1. Refresh store (reload repositories)
        await supervisorAPI('POST', '/store/reload');
        // 2. Check current add-on info
        const info = await supervisorAPI('GET', '/addons/self/info');
        const current = info.data && info.data.version;
        const latest = info.data && info.data.version_latest;
        if (!latest || !current) {
          res.end(JSON.stringify({ status: 'error', message: 'Could not read version info' }));
          return;
        }
        if (current === latest) {
          res.end(JSON.stringify({ status: 'current', version: current, message: 'Already up to date' }));
          return;
        }
        // 3. Trigger update (this will restart the container)
        await supervisorAPI('POST', '/addons/self/update');
        res.end(JSON.stringify({ status: 'updating', from: current, to: latest, message: 'Updating to ' + latest + '...' }));
      } catch (e) {
        res.end(JSON.stringify({ status: 'error', message: e.message }));
      }
    })();
    return;
  }

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
        // Inject viewport meta to make iOS resize content when keyboard opens
        const vpMeta = '<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,interactive-widget=resizes-content">';
        // Replace existing viewport meta or inject into head
        if (html.includes('<meta name="viewport"')) {
          html = html.replace(/<meta name="viewport"[^>]*>/, vpMeta);
        } else {
          html = html.replace('<head>', '<head>' + vpMeta);
        }
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
