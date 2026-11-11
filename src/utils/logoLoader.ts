import type { InMemoryLogo } from '../types/course';

const MAX_LOGO_BYTES = 5 * 1024 * 1024; // 5 MB safety cap

/**
 * Strips potentially unsafe elements and event handlers from SVG text
 * before converting it via an isolated Image + Canvas to PNG bytes.
 * Never injects SVG markup into the active document DOM.
 */
export function sanitizeSvgMarkup(rawSvg: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(rawSvg, 'image/svg+xml');
  const parserError = doc.querySelector('parsererror');
  if (parserError || !doc.documentElement || doc.documentElement.tagName.toLowerCase() !== 'svg') {
    throw new Error('Invalid SVG logo file.');
  }

  const forbiddenTags = doc.querySelectorAll(
    'script, foreignObject, iframe, object, embed, link',
  );
  forbiddenTags.forEach((node) => node.remove());

  // Strip <use> pointing to external resources and <style> @import rules
  doc.querySelectorAll('use').forEach((node) => {
    const ref =
      node.getAttribute('href') || node.getAttribute('xlink:href') || '';
    if (ref && !ref.trim().startsWith('#')) {
      node.remove();
    }
  });
  doc.querySelectorAll('style').forEach((node) => {
    if (/@import|https?:\/\//i.test(node.textContent ?? '')) {
      node.textContent = (node.textContent ?? '')
        .replace(/@import[^;]*;/gi, '')
        .replace(/url\(\s*['"]?https?:[^)]*\)/gi, 'none');
    }
  });

  // Ensure vector SVG has explicit viewBox-backed width/height for high-DPI rasterization
  const svgEl = doc.documentElement;
  const vb = svgEl.getAttribute('viewBox');
  if (vb && (!svgEl.getAttribute('width') || !svgEl.getAttribute('height'))) {
    const parts = vb.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      svgEl.setAttribute('width', String(parts[2]));
      svgEl.setAttribute('height', String(parts[3]));
    }
  }

  const allElements = doc.querySelectorAll('*');
  allElements.forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const val = attr.value.trim().toLowerCase();
      if (
        name.startsWith('on') ||
        ((name === 'href' || name === 'xlink:href') &&
          (val.startsWith('javascript:') || val.startsWith('data:text/html')))
      ) {
        el.removeAttribute(attr.name);
      }
    }
  });

  const serializer = new XMLSerializer();
  return serializer.serializeToString(doc.documentElement);
}

export function rasterizeImageBlobToPngBytes(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const tempUrl = URL.createObjectURL(blob);
    const img = new Image();

    img.onload = () => {
      try {
        const naturalW = img.naturalWidth || 400;
        const naturalH = img.naturalHeight || 200;
        const targetMax = 512;
        const scale = targetMax / Math.max(naturalW, naturalH);
        const cap = blob.type.includes('svg') ? 4.5 : 2;
        const targetW = Math.max(1, Math.round(naturalW * Math.min(cap, scale)));
        const targetH = Math.max(1, Math.round(naturalH * Math.min(cap, scale)));

        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas context unavailable for logo conversion.'));
          return;
        }
        ctx.drawImage(img, 0, 0, targetW, targetH);
        canvas.toBlob(
          async (outBlob) => {
            if (!outBlob) {
              reject(new Error('Could not convert logo image to PNG.'));
              return;
            }
            const buf = await outBlob.arrayBuffer();
            resolve(new Uint8Array(buf));
          },
          'image/png',
          1,
        );
      } catch (err) {
        reject(err instanceof Error ? err : new Error('Failed to process logo image.'));
      } finally {
        URL.revokeObjectURL(tempUrl);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(tempUrl);
      reject(new Error('Uploaded file could not be decoded as an image.'));
    };

    img.src = tempUrl;
  });
}

/**
 * Loads an optional brand or university logo strictly in browser memory.
 * PNG and JPEG bytes are embedded natively; WebP and sanitized SVG are rasterized
 * safely in memory to crisp PNG bytes so pdf-lib can embed them reliably offline.
 */
export async function loadLogoInMemory(file: File): Promise<InMemoryLogo> {
  if (file.size === 0) {
    throw new Error('The selected logo file is empty.');
  }
  if (file.size > MAX_LOGO_BYTES) {
    throw new Error('Logo image must be 5 MB or smaller.');
  }

  const lowerName = file.name.toLowerCase();
  const type = file.type.toLowerCase();

  let mimeType: 'image/png' | 'image/jpeg';
  let bytes: Uint8Array;

  if (type === 'image/png' || lowerName.endsWith('.png')) {
    mimeType = 'image/png';
    bytes = new Uint8Array(await file.arrayBuffer());
  } else if (
    type === 'image/jpeg' ||
    type === 'image/jpg' ||
    lowerName.endsWith('.jpg') ||
    lowerName.endsWith('.jpeg')
  ) {
    mimeType = 'image/jpeg';
    bytes = new Uint8Array(await file.arrayBuffer());
  } else if (type === 'image/svg+xml' || lowerName.endsWith('.svg')) {
    const rawSvg = await file.text();
    const cleanSvg = sanitizeSvgMarkup(rawSvg);
    const svgBlob = new Blob([cleanSvg], { type: 'image/svg+xml' });
    mimeType = 'image/png';
    bytes = await rasterizeImageBlobToPngBytes(svgBlob);
  } else if (type === 'image/webp' || lowerName.endsWith('.webp')) {
    mimeType = 'image/png';
    bytes = await rasterizeImageBlobToPngBytes(file);
  } else {
    throw new Error(
      'Unsupported logo format. Please upload a PNG, JPG, WebP, or SVG image.',
    );
  }

  const previewBlob = new Blob([new Uint8Array(bytes)], { type: mimeType });
  const previewUrl = URL.createObjectURL(previewBlob);

  return {
    fileName: file.name,
    mimeType,
    bytes,
    previewUrl,
  };
}

export function revokeLogoPreviewUrl(logo: InMemoryLogo | null | undefined): void {
  if (logo?.previewUrl?.startsWith('blob:')) {
    URL.revokeObjectURL(logo.previewUrl);
  }
}
