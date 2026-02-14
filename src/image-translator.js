const Tesseract = require('tesseract.js');
const sharp = require('sharp');
const { createCanvas } = require('@napi-rs/canvas');
const { translateBatch } = require('./translator');

// Reuse a single Tesseract scheduler across requests
let scheduler = null;

async function getScheduler() {
  if (scheduler) return scheduler;
  scheduler = Tesseract.createScheduler();
  // Spin up 2 workers for concurrency
  const w1 = await Tesseract.createWorker('eng+jpn+kor+chi_sim');
  const w2 = await Tesseract.createWorker('eng+jpn+kor+chi_sim');
  scheduler.addWorker(w1);
  scheduler.addWorker(w2);
  return scheduler;
}

/**
 * Fetch a remote image, run OCR to find text regions, translate them,
 * and return a new image with translated text overlaid (original text
 * covered by a filled rect in the dominant background colour).
 *
 * Returns { buffer, contentType, regions }
 */
async function translateImage(imageUrl, fromLang = 'auto', toLang = 'en') {
  // 1. Fetch the image
  const resp = await fetch(imageUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
  });
  if (!resp.ok) throw new Error(`Upstream image returned ${resp.status}`);

  const arrayBuf = await resp.arrayBuffer();
  const imgBuffer = Buffer.from(arrayBuf);
  const contentType = resp.headers.get('content-type') || 'image/png';

  // 2. Decode image metadata
  const metadata = await sharp(imgBuffer).metadata();
  const { width, height } = metadata;

  // 3. Run OCR
  const sched = await getScheduler();
  const { data } = await sched.addJob('recognize', imgBuffer);

  if (!data.words || data.words.length === 0) {
    // No text found – return original image
    return { buffer: imgBuffer, contentType, regions: [] };
  }

  // 4. Group words into lines/blocks for better translation context
  const blocks = groupWordsIntoBlocks(data.words);

  // 5. Translate all block texts
  const blockTexts = blocks.map((b) => b.text);
  const translated = await translateBatch(blockTexts, fromLang, toLang);

  // 6. Build regions metadata
  const regions = blocks.map((b, i) => ({
    x: b.x,
    y: b.y,
    w: b.w,
    h: b.h,
    original: b.text,
    translated: translated[i],
  }));

  // 7. Render the overlay image using canvas
  // Convert to PNG for canvas manipulation
  const pngBuffer = await sharp(imgBuffer).png().toBuffer();
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Draw original image onto canvas
  const { Image } = require('@napi-rs/canvas');
  const img = new Image();
  img.src = pngBuffer;
  ctx.drawImage(img, 0, 0, width, height);

  // For each region: cover original text, draw translated text
  for (const region of regions) {
    // Sample background colour from just outside the text region
    const bgColor = await sampleBackgroundColor(imgBuffer, region, width, height);

    // Cover original text with background-coloured rectangle
    ctx.fillStyle = bgColor;
    const padding = 2;
    ctx.fillRect(region.x - padding, region.y - padding, region.w + padding * 2, region.h + padding * 2);

    // Draw translated text
    const fontSize = Math.max(10, Math.min(region.h * 0.8, 28));
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.fillStyle = getContrastColor(bgColor);
    ctx.textBaseline = 'top';

    // Word-wrap inside the region
    drawWrappedText(ctx, region.translated, region.x, region.y, region.w, fontSize * 1.2);
  }

  const outputBuffer = Buffer.from(canvas.toBuffer('image/png'));

  return { buffer: outputBuffer, contentType: 'image/png', regions };
}

/**
 * Group OCR words that are spatially close into blocks so we can translate
 * coherent phrases rather than individual words.
 */
function groupWordsIntoBlocks(words) {
  if (!words || words.length === 0) return [];

  // Filter low-confidence noise
  const filtered = words.filter((w) => w.confidence > 40 && w.text.trim().length > 0);
  if (filtered.length === 0) return [];

  // Sort by vertical then horizontal position
  const sorted = [...filtered].sort((a, b) => {
    const ay = a.bbox.y0;
    const by = b.bbox.y0;
    if (Math.abs(ay - by) < 10) return a.bbox.x0 - b.bbox.x0;
    return ay - by;
  });

  const blocks = [];
  let current = null;

  for (const word of sorted) {
    const wb = word.bbox;
    if (
      current &&
      Math.abs(wb.y0 - current.lastY) < current.avgHeight * 1.5 &&
      wb.x0 - current.lastX < current.avgHeight * 3
    ) {
      // Merge into current block
      current.words.push(word.text);
      current.x = Math.min(current.x, wb.x0);
      current.y = Math.min(current.y, wb.y0);
      current.x2 = Math.max(current.x2, wb.x1);
      current.y2 = Math.max(current.y2, wb.y1);
      current.lastX = wb.x1;
      current.lastY = wb.y0;
      current.avgHeight = (current.y2 - current.y) / Math.max(current.lines, 1);
    } else {
      if (current) {
        blocks.push(finalizeBlock(current));
      }
      current = {
        words: [word.text],
        x: wb.x0,
        y: wb.y0,
        x2: wb.x1,
        y2: wb.y1,
        lastX: wb.x1,
        lastY: wb.y0,
        avgHeight: wb.y1 - wb.y0,
        lines: 1,
      };
    }
  }
  if (current) blocks.push(finalizeBlock(current));

  return blocks;
}

function finalizeBlock(b) {
  return {
    text: b.words.join(' '),
    x: b.x,
    y: b.y,
    w: b.x2 - b.x,
    h: b.y2 - b.y,
  };
}

/**
 * Sample a few pixels around a region to estimate the background colour.
 */
async function sampleBackgroundColor(imgBuffer, region, imgW, imgH) {
  try {
    // Sample a small strip above the region
    const sampleY = Math.max(0, region.y - 3);
    const sampleH = Math.min(3, imgH - sampleY);
    const sampleX = Math.max(0, region.x);
    const sampleW = Math.min(region.w, imgW - sampleX);

    if (sampleW <= 0 || sampleH <= 0) return '#ffffff';

    const { data, info } = await sharp(imgBuffer)
      .extract({ left: sampleX, top: sampleY, width: sampleW, height: sampleH })
      .raw()
      .toBuffer({ resolveWithObject: true });

    // Average the pixel values
    let r = 0,
      g = 0,
      b = 0;
    const channels = info.channels;
    const pixelCount = data.length / channels;
    for (let i = 0; i < data.length; i += channels) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
    }
    r = Math.round(r / pixelCount);
    g = Math.round(g / pixelCount);
    b = Math.round(b / pixelCount);

    return `rgb(${r},${g},${b})`;
  } catch {
    return '#ffffff';
  }
}

/**
 * Pick black or white text depending on background luminance.
 */
function getContrastColor(bgColor) {
  const match = bgColor.match(/\d+/g);
  if (!match || match.length < 3) return '#000000';
  const [r, g, b] = match.map(Number);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? '#000000' : '#ffffff';
}

/**
 * Draw text that wraps within a given width.
 */
function drawWrappedText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(' ');
  let line = '';
  let currentY = y;

  for (const word of words) {
    const testLine = line ? `${line} ${word}` : word;
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && line) {
      ctx.fillText(line, x, currentY);
      line = word;
      currentY += lineHeight;
    } else {
      line = testLine;
    }
  }
  if (line) {
    ctx.fillText(line, x, currentY);
  }
}

module.exports = { translateImage };
