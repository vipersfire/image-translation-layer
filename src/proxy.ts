import { URL } from 'url';
import * as cheerio from 'cheerio';
import { Request, Response } from 'express';
import { translateBatch } from './translator';

type CheerioElement = cheerio.Element;

/**
 * Fetch a remote page, translate visible text nodes, rewrite asset URLs so
 * they route back through this proxy, and inject the client-side overlay
 * script that handles image translation in the browser.
 */
export async function proxyAndTranslate(req: Request, res: Response): Promise<Response | void> {
  const targetUrl = req.query.url as string;
  const toLang = (req.query.to as string) || 'en';
  const fromLang = (req.query.from as string) || 'auto';

  if (!targetUrl) {
    return res.status(400).send('Missing ?url= parameter');
  }

  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return res.status(400).send('Invalid URL');
  }

  try {
    const upstream = await fetch(targetUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,*/*',
        Referer: parsed.origin,
      },
      redirect: 'follow', // follow HTTP → HTTPS redirects automatically
    });

    const contentType = upstream.headers.get('content-type') || '';

    // --- Non-HTML resources: stream them through as-is ---
    if (!contentType.includes('text/html')) {
      const arrayBuf = await upstream.arrayBuffer();
      res.set('Content-Type', contentType);
      return res.send(Buffer.from(arrayBuf));
    }

    // --- HTML: parse, translate, rewrite ---
    const html = await upstream.text();
    const $ = cheerio.load(html);

    // Collect visible text nodes
    const textNodes: string[] = [];
    const textElements: CheerioElement[] = [];
    $('body *')
      .not('script, style, noscript, svg, code, pre')
      .contents()
      .each(function (this: CheerioElement) {
        if (this.type === 'text') {
          const text = $(this).text().trim();
          if (text.length > 0) {
            textNodes.push(text);
            textElements.push(this);
          }
        }
      });

    // Batch translate all text nodes
    if (textNodes.length > 0) {
      const translated = await translateBatch(textNodes, fromLang, toLang);
      for (let i = 0; i < textElements.length; i++) {
        if (translated[i]) {
          $(textElements[i]).replaceWith(translated[i]);
        }
      }
    }

    // Rewrite relative URLs so sub-resources route through the proxy
    const baseOrigin = parsed.origin;
    const basePath = parsed.pathname.replace(/\/[^/]*$/, '/');

    const resolveUrl = (href: string | undefined): string | undefined => {
      if (!href) return href;
      if (href.startsWith('data:') || 
          href.startsWith('javascript:') || 
          href.startsWith('vbscript:') ||
          href.startsWith('#')) {
        return href;
      }
      try {
        const abs = new URL(href, targetUrl).href;
        return `/proxy?url=${encodeURIComponent(abs)}&to=${toLang}&from=${fromLang}`;
      } catch {
        return href;
      }
    };

    $('a[href]').each(function (this: CheerioElement) {
      const href = $(this).attr('href');
      const resolved = resolveUrl(href);
      if (resolved) $(this).attr('href', resolved);
    });
    $('img[src]').each(function (this: CheerioElement) {
      const src = $(this).attr('src');
      // Keep original src as data attribute for the overlay script
      if (src) {
        const absSrc = new URL(src, targetUrl).href;
        $(this).attr('data-original-src', absSrc);
        const resolved = resolveUrl(src);
        if (resolved) $(this).attr('src', resolved);
      }
    });
    $('link[href]').each(function (this: CheerioElement) {
      const href = $(this).attr('href');
      const resolved = resolveUrl(href);
      if (resolved) $(this).attr('href', resolved);
    });
    $('script[src]').each(function (this: CheerioElement) {
      const src = $(this).attr('src');
      const resolved = resolveUrl(src);
      if (resolved) $(this).attr('src', resolved);
    });

    // Inject <base> so any URLs we missed still resolve
    $('head').prepend(`<base href="${baseOrigin}${basePath}">`);

    // Inject our client-side overlay script + toolbar
    $('body').append(`
      <script src="/static/overlay.js"></script>
      <link rel="stylesheet" href="/static/overlay.css">
      <script>
        window.__ITL_CONFIG__ = {
          toLang: "${toLang}",
          fromLang: "${fromLang}",
          proxyBase: "/proxy"
        };
        document.addEventListener('DOMContentLoaded', function() {
          if (window.ITL) window.ITL.init();
        });
        if (document.readyState !== 'loading') {
          if (window.ITL) window.ITL.init();
        }
      </script>
    `);

    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send($.html());
  } catch (err) {
    console.error('[proxy]', err);
    res.status(502).send(`Failed to fetch upstream: ${(err as Error).message}`);
  }
}
