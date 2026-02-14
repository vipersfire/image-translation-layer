# Image Translation Layer

A proxy-based web app for reading comics in any language. It fetches comic pages through a proxy, translates HTML text content, detects text inside images via OCR, and overlays translated text at the exact original positions.

## Features

- **Web Proxy** — paste any comic site URL and browse it through the translation layer
- **HTML Translation** — all visible text nodes are translated on the server before the page reaches you
- **Image OCR** — Tesseract.js detects text in images (speech bubbles, SFX, signs)
- **Text Overlay** — original text is covered with a background-matched rectangle and replaced with translated text
- **Language Selection** — pick source (or auto-detect) and target languages
- **Click-to-Translate** — click any image on a proxied page to translate it, or hit "Translate Images" to do them all
- **Zero Cost** — uses free translation (google-translate-api-x) and local OCR (Tesseract.js), no API keys required

## Tech Stack

| Layer | Tool | Why |
|-------|------|-----|
| Server | Express | Lightweight, minimal boilerplate |
| Proxy | Custom fetch + Cheerio | Full control over HTML rewriting |
| Translation | google-translate-api-x | Free, no API key, batch support |
| OCR | Tesseract.js | Free, local, supports JP/KR/CN/EN |
| Image Processing | Sharp + @napi-rs/canvas | Fast native bindings, low memory |
| Frontend | Vanilla HTML/CSS/JS | Zero framework overhead |

## Getting Started

```bash
# Install dependencies
npm install

# Start the server
npm start

# Or with auto-reload during development (Node 18+)
npm run dev
```

Open `http://localhost:3000` in your browser.

## How It Works

1. Enter a comic page URL and select languages on the home screen
2. The server fetches the page, parses the HTML with Cheerio, and batch-translates all visible text nodes
3. All links and asset URLs are rewritten to route through the proxy so navigation stays translated
4. A client-side overlay script is injected into every proxied page
5. Clicking an image (or pressing "Translate Images") sends it to the `/api/translate-image` endpoint
6. The server runs Tesseract OCR to find text regions, groups words into blocks, translates them
7. Original text is covered with a background-colour-matched rectangle, and the translation is drawn on top
8. The modified image is returned to the browser and swapped in place

## Project Structure

```
├── public/
│   ├── index.html        # Landing page with URL input and language selector
│   ├── overlay.js         # Client-side script injected into proxied pages
│   └── overlay.css        # Styles for toolbar, loaders, and overlay regions
├── src/
│   ├── server.js          # Express app entry point
│   ├── proxy.js           # Fetch → translate → rewrite HTML pipeline
│   ├── translator.js      # Google Translate wrapper (batch + single)
│   └── image-translator.js # OCR → translate → canvas overlay pipeline
├── package.json
└── .gitignore
```

## Supported Languages

Auto-detect, Japanese, Korean, Chinese (Simplified/Traditional), English, Spanish, French, German, Thai, Indonesian, Vietnamese — and any other language supported by Google Translate.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `SSL_KEY` | — | Path to SSL private key (enables HTTPS) |
| `SSL_CERT` | — | Path to SSL certificate (enables HTTPS) |

## Running over HTTPS

The app runs on plain HTTP by default, which is fine for local use since all upstream fetches to comic sites use HTTPS server-side (the browser never contacts the comic site directly).

To enable HTTPS on the proxy itself (useful for LAN access or deployment):

```bash
# Generate a self-signed cert for local dev
openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 365 -nodes -subj '/CN=localhost'

# Start with HTTPS
SSL_KEY=key.pem SSL_CERT=cert.pem npm start
```
