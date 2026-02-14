const express = require('express');
const path = require('path');
const { proxyAndTranslate } = require('./proxy');
const { translateImage } = require('./image-translator');

const app = express();
const PORT = process.env.PORT || 3000;

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

app.listen(PORT, () => {
  console.log(`Image Translation Layer running → http://localhost:${PORT}`);
});
