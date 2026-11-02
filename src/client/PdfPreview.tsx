import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, PDFDocumentLoadingTask, RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import 'pdfjs-dist/web/pdf_viewer.css';
export interface PdfTarget { page: number; x?: number; y?: number; nonce: number }
export default function PdfPreview({ url, target, onLocate }: { url: string; target?: PdfTarget; onLocate?: (page: number, x: number, y: number) => void }) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null); const [page, setPage] = useState(1); const [zoom, setZoom] = useState(1); const [width, setWidth] = useState(600); const [error, setError] = useState('');
  const host = useRef<HTMLDivElement>(null); const canvas = useRef<HTMLCanvasElement>(null); const text = useRef<HTMLDivElement>(null); const render = useRef<RenderTask | null>(null);
  const dimensions = useRef({ width: 1, height: 1 });
  useEffect(() => {
    const element = host.current; if (!element) return;
    const observer = new ResizeObserver(() => setWidth(Math.max(100, element.clientWidth - 32))); observer.observe(element); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let cancelled = false; let document: PDFDocumentProxy | undefined; let task: PDFDocumentLoadingTask | undefined;
    void (async () => {
      try {
        const pdf = await import('pdfjs-dist/legacy/build/pdf.mjs'); pdf.GlobalWorkerOptions.workerSrc = workerUrl;
        task = pdf.getDocument({ url }); document = await task.promise;
        if (!cancelled) { setDoc(document); setPage(current => Math.min(current, document!.numPages)); setError(''); }
      } catch (failure) { if (!cancelled) setError((failure as Error).message); }
    })();
    return () => { cancelled = true; render.current?.cancel(); void task?.destroy(); };
  }, [url]);
  useEffect(() => { if (target && doc) setPage(Math.max(1, Math.min(doc.numPages, target.page))); }, [target, doc]);
  useEffect(() => {
    if (!doc || !canvas.current || !text.current) return; let cancelled = false;
    const draw = async () => {
      try {
        render.current?.cancel();
        const pdfPage = await doc.getPage(page); if (cancelled || !canvas.current || !text.current) return;
        const natural = pdfPage.getViewport({ scale: 1 }); dimensions.current = { width: natural.width, height: natural.height };
        const scale = width / natural.width * zoom; const viewport = pdfPage.getViewport({ scale }); const ratio = window.devicePixelRatio || 1;
        canvas.current.width = Math.floor(viewport.width * ratio); canvas.current.height = Math.floor(viewport.height * ratio); canvas.current.style.width = `${viewport.width}px`; canvas.current.style.height = `${viewport.height}px`;
        const container = text.current; container.replaceChildren(); container.style.width = `${viewport.width}px`; container.style.height = `${viewport.height}px`; container.style.setProperty('--total-scale-factor', String(scale));
        const pdf = await import('pdfjs-dist/legacy/build/pdf.mjs');
        render.current = pdfPage.render({ canvas: canvas.current, viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
        await render.current.promise;
        if (!cancelled) { const layer = new pdf.TextLayer({ textContentSource: await pdfPage.getTextContent(), container, viewport }); await layer.render(); }
      } catch (failure) { if (!cancelled && (failure as Error).name !== 'RenderingCancelledException') setError((failure as Error).message); }
    };
    void draw(); return () => { cancelled = true; render.current?.cancel(); };
  }, [doc, page, width, zoom]);
  return <div className="pdf-reader"><div className="pdf-toolbar"><button disabled={page <= 1} onClick={() => setPage(p => p - 1)} aria-label="Previous PDF page">‹</button><label>Page <input aria-label="PDF page" type="number" min={1} max={doc?.numPages || 1} value={page} onChange={event => setPage(Math.max(1, Math.min(doc?.numPages || 1, Number(event.target.value) || 1)))}/></label><span>/ {doc?.numPages || '…'}</span><button disabled={page >= (doc?.numPages || 1)} onClick={() => setPage(p => p + 1)} aria-label="Next PDF page">›</button><button onClick={() => setZoom(z => Math.max(.5, z - .1))} aria-label="Zoom out">−</button><button onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button><button onClick={() => setZoom(z => Math.min(2, z + .1))} aria-label="Zoom in">+</button>{onLocate && <small>Ctrl/Cmd+click → source</small>}</div><div ref={host} className="pdf-scroll">{error && <p role="alert">PDF preview: {error} <a href={url} target="_blank" rel="noreferrer">Open PDF</a></p>}<div className="pdf-page" onClick={event => {
    if (!(event.ctrlKey || event.metaKey) || !canvas.current || !onLocate) return;
    const rect = canvas.current.getBoundingClientRect(); onLocate(page, (event.clientX - rect.left) / rect.width * dimensions.current.width, (event.clientY - rect.top) / rect.height * dimensions.current.height);
  }}><canvas ref={canvas}/><div className="textLayer" ref={text}/></div></div></div>;
}
