const express = require('express');
const path = require('path');
const fs = require('fs');
const { proxyAndTranslate } = require('./proxy');
const { translateImage } = require('./image-translator');

const app = express();
const PORT = process.env.PORT || 3000;
const SSL_KEY = process.env.SSL_KEY;   // path to key.pem
const SSL_CERT = process.env.SSL_CERT; // path to cert.pem

// Serve static frontend assets
app.use('/static', express.static(path.join(__dirname, '..', 'public')));

// Serve the landing / control UI
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ---- Image translation endpoint ----
// Fetches a remote image, runs OCR, and returns a translated overlay version
app.get('/api/translate-image', async (req, res) => {
  const { url, from, to } = req.query;
  if (!url || !to) {
    return res.status(400).json({ error: 'url and to query params required' });
  }

  try {
    const { buffer, contentType, regions } = await translateImage(url, from || 'auto', to);
    // Return JSON with base64 image + region metadata so the frontend can
    // choose between the pre-rendered image or its own overlay strategy.
    res.json({
      image: `data:${contentType};base64,${buffer.toString('base64')}`,
      regions, // [{x,y,w,h,original,translated}]
    });
  } catch (err) {
    console.error('[image-translate]', err);
    res.status(502).json({ error: 'Image translation failed', detail: err.message });
  }
});

// ---- Proxy endpoint ----
// Everything under /proxy?url=<encoded-url>&to=<lang> is fetched, rewritten
// and returned with translated text.
app.get('/proxy', proxyAndTranslate);

// Proxy sub-resources (css, js, images referenced by the page)
app.get('/proxy/*', proxyAndTranslate);

// Start with HTTPS if certs are provided, otherwise plain HTTP
if (SSL_KEY && SSL_CERT) {
  const https = require('https');
  const opts = {
    key: fs.readFileSync(SSL_KEY),
    cert: fs.readFileSync(SSL_CERT),
  };
  https.createServer(opts, app).listen(PORT, () => {
    console.log(`Image Translation Layer running → https://localhost:${PORT}`);
  });
} else {
  app.listen(PORT, () => {
    console.log(`Image Translation Layer running → http://localhost:${PORT}`);
    console.log('  Tip: set SSL_KEY and SSL_CERT env vars to enable HTTPS');
  });
}
