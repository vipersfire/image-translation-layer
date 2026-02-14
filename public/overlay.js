/**
 * Client-side overlay script — injected into proxied pages.
 *
 * When a user clicks an image, this script sends it to the server-side OCR
 * pipeline and renders translated text overlays on top of the image.
 */
(function () {
  'use strict';

  const ITL = {
    processing: new Set(),

    init() {
      this.injectToolbar();
      this.attachImageHandlers();
      console.log('[ITL] Image Translation Layer initialized');
    },

    /** Floating toolbar so users can toggle overlays and change settings */
    injectToolbar() {
      const bar = document.createElement('div');
      bar.id = 'itl-toolbar';
      bar.innerHTML = `
        <div class="itl-toolbar-inner">
          <span class="itl-logo">ITL</span>
          <button id="itl-translate-all" title="Translate all images on page">
            Translate Images
          </button>
          <button id="itl-toggle" title="Toggle overlay visibility">
            Toggle Overlays
          </button>
          <a href="/" class="itl-home" title="Back to home">Home</a>
        </div>
      `;
      document.body.appendChild(bar);

      document.getElementById('itl-translate-all').addEventListener('click', () => {
        this.translateAllImages();
      });

      let overlaysVisible = true;
      document.getElementById('itl-toggle').addEventListener('click', () => {
        overlaysVisible = !overlaysVisible;
        document.querySelectorAll('.itl-overlay-container').forEach((el) => {
          el.style.display = overlaysVisible ? 'block' : 'none';
        });
      });
    },

    /** Make every <img> clickable to trigger translation */
    attachImageHandlers() {
      document.querySelectorAll('img').forEach((img) => {
        img.style.cursor = 'pointer';
        img.title = 'Click to translate text in this image';
        img.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.translateSingleImage(img);
        });
      });
    },

    /** Translate one image */
    async translateSingleImage(img) {
      const originalSrc = img.dataset.originalSrc || img.src;
      if (this.processing.has(originalSrc)) return;
      this.processing.add(originalSrc);

      // Visual loading indicator
      const wrapper = this.ensureWrapper(img);
      const loader = document.createElement('div');
      loader.className = 'itl-loader';
      loader.textContent = 'Translating…';
      wrapper.appendChild(loader);

      try {
        const config = window.__ITL_CONFIG__ || { toLang: 'en', fromLang: 'auto' };
        const apiUrl = `/api/translate-image?url=${encodeURIComponent(originalSrc)}&to=${config.toLang}&from=${config.fromLang}`;

        const resp = await fetch(apiUrl);
        if (!resp.ok) throw new Error(`Server returned ${resp.status}`);

        const data = await resp.json();

        if (data.regions && data.regions.length > 0) {
          // Strategy: replace the image src with the pre-rendered translated version
          img.src = data.image;

          // Also add hoverable overlay regions for inspection
          this.renderOverlayRegions(wrapper, img, data.regions);
        } else {
          this.showToast(wrapper, 'No text detected in image');
        }
      } catch (err) {
        console.error('[ITL]', err);
        this.showToast(wrapper, 'Translation failed');
      } finally {
        loader.remove();
        this.processing.delete(originalSrc);
      }
    },

    /** Translate every image on the page */
    async translateAllImages() {
      const images = document.querySelectorAll('img');
      // Process in small batches to avoid overwhelming the server
      const batch = 3;
      for (let i = 0; i < images.length; i += batch) {
        const slice = Array.from(images).slice(i, i + batch);
        await Promise.all(slice.map((img) => this.translateSingleImage(img)));
      }
    },

    /** Wrap an image in a positioned container if not already wrapped */
    ensureWrapper(img) {
      if (img.parentElement?.classList?.contains('itl-wrapper')) {
        return img.parentElement;
      }
      const wrapper = document.createElement('div');
      wrapper.className = 'itl-wrapper';
      wrapper.style.position = 'relative';
      wrapper.style.display = 'inline-block';
      img.parentElement.insertBefore(wrapper, img);
      wrapper.appendChild(img);
      return wrapper;
    },

    /** Render hoverable tooltip regions over the image */
    renderOverlayRegions(wrapper, img, regions) {
      // Remove previous overlay container if any
      const prev = wrapper.querySelector('.itl-overlay-container');
      if (prev) prev.remove();

      const container = document.createElement('div');
      container.className = 'itl-overlay-container';
      container.style.cssText =
        'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;';

      const imgRect = img.getBoundingClientRect();
      const scaleX = img.clientWidth / (img.naturalWidth || img.clientWidth);
      const scaleY = img.clientHeight / (img.naturalHeight || img.clientHeight);

      for (const r of regions) {
        const div = document.createElement('div');
        div.className = 'itl-region';
        div.style.cssText = `
          position: absolute;
          left: ${r.x * scaleX}px;
          top: ${r.y * scaleY}px;
          width: ${r.w * scaleX}px;
          height: ${r.h * scaleY}px;
          pointer-events: auto;
          cursor: help;
        `;
        div.title = `Original: ${r.original}\nTranslated: ${r.translated}`;
        container.appendChild(div);
      }

      wrapper.appendChild(container);
    },

    showToast(wrapper, msg) {
      const toast = document.createElement('div');
      toast.className = 'itl-toast';
      toast.textContent = msg;
      wrapper.appendChild(toast);
      setTimeout(() => toast.remove(), 3000);
    },
  };

  window.ITL = ITL;
})();
