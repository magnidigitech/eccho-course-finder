import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface PdfLinkHotspot {
  id: string;
  url: string;
  leftPct: number;
  topPct: number;
  widthPct: number;
  heightPct: number;
}

interface PdfPreviewCanvasProps {
  pdfBytes: Uint8Array;
  pageNumber: number; // 1-indexed
  courseTitle: string;
}

function isSafeExternalUrl(raw: string | undefined): raw is string {
  if (!raw) return false;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function PdfPreviewCanvas({
  pdfBytes,
  pageNumber,
  courseTitle,
}: PdfPreviewCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [containerWidth, setContainerWidth] = useState<number>(640);
  const [pdfDocument, setPdfDocument] = useState<pdfjsLib.PDFDocumentProxy | null>(
    null,
  );
  const [renderError, setRenderError] = useState<string | null>(null);
  const [isRendering, setIsRendering] = useState<boolean>(true);
  const [links, setLinks] = useState<PdfLinkHotspot[]>([]);

  // Track responsive container width without polling
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateWidth = () => {
      const next = Math.max(280, Math.floor(el.clientWidth));
      setContainerWidth((prev) => (Math.abs(prev - next) > 2 ? next : prev));
    };

    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Load PDFDocumentProxy whenever generated pdfBytes change
  useEffect(() => {
    let cancelled = false;
    let loadedDoc: pdfjsLib.PDFDocumentProxy | null = null;
    setIsRendering(true);
    setRenderError(null);

    // Pass a defensive copy so PDF.js worker transfer never detaches caller's Uint8Array
    const loadingTask = pdfjsLib.getDocument({ data: pdfBytes.slice() });

    loadingTask.promise
      .then((doc) => {
        if (cancelled) {
          void doc.cleanup();
          return;
        }
        loadedDoc = doc;
        setPdfDocument(doc);
      })
      .catch(() => {
        if (!cancelled) {
          setRenderError('Unable to initialize the PDF preview renderer.');
          setIsRendering(false);
        }
      });

    return () => {
      cancelled = true;
      if (loadedDoc) {
        void loadedDoc.cleanup();
      }
      void loadingTask.destroy();
      setPdfDocument(null);
    };
  }, [pdfBytes]);

  // Render requested page of the actual generated PDF onto canvas
  useEffect(() => {
    if (!pdfDocument || !canvasRef.current) return;
    if (pageNumber < 1 || pageNumber > pdfDocument.numPages) return;

    let cancelled = false;
    let renderTask: pdfjsLib.RenderTask | null = null;
    setIsRendering(true);
    setRenderError(null);
    setLinks([]);

    const renderPage = async () => {
      try {
        const page = await pdfDocument.getPage(pageNumber);
        if (cancelled || !canvasRef.current) return;

        const baseViewport = page.getViewport({ scale: 1 });
        const targetCssWidth = Math.min(containerWidth, 720);
        const cssScale = targetCssWidth / baseViewport.width;
        const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
        const renderViewport = page.getViewport({ scale: cssScale * dpr });
        const cssViewport = page.getViewport({ scale: cssScale });

        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');
        if (!context) {
          throw new Error('2D canvas context unavailable.');
        }

        canvas.width = Math.floor(renderViewport.width);
        canvas.height = Math.floor(renderViewport.height);
        canvas.style.width = `${Math.floor(cssViewport.width)}px`;
        canvas.style.height = `${Math.floor(cssViewport.height)}px`;

        renderTask = page.render({
          canvasContext: context,
          viewport: renderViewport,
          canvas,
        });
        await renderTask.promise;
        if (cancelled) return;

        // Map real PDF URI link annotations so preview links are clickable
        const annots = await page.getAnnotations();
        if (cancelled) return;

        const hotspots: PdfLinkHotspot[] = [];
        for (let idx = 0; idx < annots.length; idx += 1) {
          const annot = annots[idx] as {
            subtype?: string;
            url?: string;
            rect?: number[];
          };
          if (
            annot.subtype === 'Link' &&
            isSafeExternalUrl(annot.url) &&
            Array.isArray(annot.rect) &&
            annot.rect.length === 4
          ) {
            const [x1, y1] = cssViewport.convertToViewportPoint(
              annot.rect[0],
              annot.rect[1],
            );
            const [x2, y2] = cssViewport.convertToViewportPoint(
              annot.rect[2],
              annot.rect[3],
            );
            const minX = Math.min(x1, x2);
            const maxX = Math.max(x1, x2);
            const minY = Math.min(y1, y2);
            const maxY = Math.max(y1, y2);

            hotspots.push({
              id: `pdf-link-${pageNumber}-${idx}`,
              url: annot.url,
              leftPct: (minX / cssViewport.width) * 100,
              topPct: (minY / cssViewport.height) * 100,
              widthPct: ((maxX - minX) / cssViewport.width) * 100,
              heightPct: ((maxY - minY) / cssViewport.height) * 100,
            });
          }
        }

        setLinks(hotspots);
        setIsRendering(false);
      } catch (err) {
        if (
          err &&
          typeof err === 'object' &&
          'name' in err &&
          err.name === 'RenderingCancelledException'
        ) {
          return;
        }
        if (!cancelled) {
          setRenderError('Failed to render this PDF preview page.');
          setIsRendering(false);
        }
      }
    };

    void renderPage();

    return () => {
      cancelled = true;
      if (renderTask) {
        renderTask.cancel();
      }
    };
  }, [pdfDocument, pageNumber, containerWidth]);

  return (
    <div ref={containerRef} className="pdf-preview-stage">
      {renderError ? (
        <div role="alert" className="alert-banner alert-error">
          {renderError}
        </div>
      ) : (
        <div className="pdf-page-frame">
          <canvas
            ref={canvasRef}
            className="pdf-page-canvas"
            aria-label={`Rendered PDF page ${pageNumber} for ${courseTitle}`}
          />
          {links.map((link) => (
            <a
              key={link.id}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="pdf-link-hotspot"
              aria-label={`Open university website ${link.url} in a new tab`}
              style={{
                left: `${link.leftPct}%`,
                top: `${link.topPct}%`,
                width: `${link.widthPct}%`,
                height: `${link.heightPct}%`,
              }}
            />
          ))}
          {isRendering && (
            <div className="pdf-render-overlay" aria-live="polite">
              <progress
                aria-label="Rendering PDF page preview"
                className="loading-spinner"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
