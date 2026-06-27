// Optional SVG→PNG rasterization (docs/Architecture.md). PNG bytes require a real
// canvas + the browser's SVG rasterizer, so this path runs ONLY in a browser; outside
// one (Node/SSR/headless) it resolves to `null` and the caller falls back to the SVG.
// It is intentionally feature-gated and not exercised by the test suite, which pins the
// deterministic SVG instead.

/**
 * Rasterize an SVG string to PNG bytes using an offscreen canvas. Resolves to `null`
 * when no DOM/canvas is available, or on any load/encode failure (never throws).
 */
export function rasterizeSvgToPng(svg: string): Promise<Uint8Array | null> {
  if (typeof document === 'undefined' || typeof Image === 'undefined' || typeof URL === 'undefined') {
    return Promise.resolve(null);
  }
  return new Promise<Uint8Array | null>((resolve) => {
    try {
      const m = /width="(\d+)"\s+height="(\d+)"/.exec(svg);
      const width = m ? Number(m[1]) : 800;
      const height = m ? Number(m[2]) : 600;

      const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) { URL.revokeObjectURL(url); resolve(null); return; }
          ctx.drawImage(img, 0, 0);
          URL.revokeObjectURL(url);
          canvas.toBlob((png) => {
            if (!png) { resolve(null); return; }
            png.arrayBuffer().then((buf) => resolve(new Uint8Array(buf))).catch(() => resolve(null));
          }, 'image/png');
        } catch {
          URL.revokeObjectURL(url);
          resolve(null);
        }
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    } catch {
      resolve(null);
    }
  });
}
