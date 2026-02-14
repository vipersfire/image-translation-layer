import translate from 'google-translate-api-x';

/**
 * Translate a single string.
 */
export async function translateText(text: string, from: string = 'auto', to: string = 'en'): Promise<string> {
  if (!text || !text.trim()) return text;
  try {
    const result = await translate(text, { from, to });
    return result.text;
  } catch (err) {
    console.error('[translate]', (err as Error).message);
    return text; // fallback to original
  }
}

/**
 * Translate an array of strings in one shot (batched).
 * google-translate-api-x supports array input natively.
 */
export async function translateBatch(texts: string[], from: string = 'auto', to: string = 'en'): Promise<string[]> {
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
    console.error('[translateBatch]', (err as Error).message);
    return texts; // fallback to originals
  }
}
