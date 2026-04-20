const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8080;
const ROOT = __dirname;
const TUNING_FILE = path.join(ROOT, 'tuning.json');

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.mp3': 'audio/mpeg',
  '.fbx': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
};

const server = http.createServer((req, res) => {
  // Save tuning endpoint
  if (req.method === 'POST' && req.url === '/save-tuning') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        JSON.parse(body); // validate
        fs.writeFileSync(TUNING_FILE, body, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
        console.log('Tuning saved.');
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(`{"error":"${e.message}"}`);
      }
    });
    return;
  }

  // Static file serving
  let filePath = req.url.split('?')[0];
  if (filePath === '/') filePath = '/index.html';
  const fullPath = path.join(ROOT, filePath);

  // Prevent directory traversal
  if (!fullPath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end();
    return;
  }

  const ext = path.extname(fullPath);
  const mime = MIME[ext] || 'application/octet-stream';

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Game server running at http://localhost:${PORT}`);
  console.log(`Tuner at http://localhost:${PORT}/tuner.html`);
});
