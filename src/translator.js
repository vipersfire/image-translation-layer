const translate = require('google-translate-api-x');

/**
 * Translate a single string.
 */
async function translateText(text, from = 'auto', to = 'en') {
  if (!text || !text.trim()) return text;
  try {
    const result = await translate(text, { from, to });
    return result.text;
  } catch (err) {
    console.error('[translate]', err.message);
    return text; // fallback to original
  }
}

/**
 * Translate an array of strings in one shot (batched).
 * google-translate-api-x supports array input natively.
 */
async function translateBatch(texts, from = 'auto', to = 'en') {
  if (!texts || texts.length === 0) return [];

  // Filter out empty strings, keep index mapping
  const entries = texts.map((t, i) => ({ i, t: (t || '').trim() }));
  const nonEmpty = entries.filter((e) => e.t.length > 0);
  if (nonEmpty.length === 0) return texts;

  try {
    const results = await translate(
      nonEmpty.map((e) => e.t),
      { from, to }
    );

    const output = [...texts];
    const translated = Array.isArray(results) ? results : [results];
    for (let j = 0; j < nonEmpty.length; j++) {
      output[nonEmpty[j].i] = translated[j]?.text ?? texts[nonEmpty[j].i];
    }
    return output;
  } catch (err) {
    console.error('[translateBatch]', err.message);
    return texts; // fallback to originals
  }
}

module.exports = { translateText, translateBatch };
