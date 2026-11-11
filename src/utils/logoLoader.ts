import type { InMemoryLogo } from '../types/course';

const MAX_LOGO_BYTES = 5 * 1024 * 1024; // 5 MB safety cap

function renderImageFileToPngBytes(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const tempUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      try {
        const naturalW = img.naturalWidth || 400;
        const naturalH = img.naturalHeight || 120;
        const scale = Math.min(1, 800 / Math.max(naturalW, naturalH));
        const targetW = Math.max(1, Math.round(naturalW * scale));
        const targetH = Math.max(1, Math.round(naturalH * scale));

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
          async (blob) => {
            if (!blob) {
              reject(new Error('Could not convert uploaded logo to PNG.'));
              return;
            }
            const buf = await blob.arrayBuffer();
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
 * Loads an optional brand logo strictly in browser memory.
 * PNG and JPEG bytes are embedded natively; WebP and SVG are rasterized
 * safely in memory to PNG so pdf-lib can embed them reliably.
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
  } else if (
    type === 'image/webp' ||
    type === 'image/svg+xml' ||
    lowerName.endsWith('.webp') ||
    lowerName.endsWith('.svg')
  ) {
    mimeType = 'image/png';
    bytes = await renderImageFileToPngBytes(file);
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

