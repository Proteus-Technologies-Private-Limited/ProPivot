// Unified pointer-based drag for the grid (column reorder, field-list chips,
// resize). HTML5 drag-and-drop does not fire on touch devices, so the grid drives
// its own drag from Pointer Events — one code path for mouse, touch and pen.
//
// The helper owns the plumbing: a small movement threshold (so taps still click),
// pointer capture, a floating ghost label, and elementFromPoint hit-testing with
// the ghost temporarily hidden. The caller supplies what to highlight and what to
// do on drop.

export interface PointerDragSpec {
  /** Text shown in the floating drag ghost. */
  label: string;
  /** Called on each move with the element under the pointer (ghost excluded). */
  move?: (under: Element | null, x: number, y: number) => void;
  /** Called once on release with the element under the pointer. */
  drop?: (under: Element | null, x: number, y: number) => void;
  /** Always called at the end (commit or cancel) — clear any highlight here. */
  end?: () => void;
}

const THRESHOLD = 5; // px before a press becomes a drag

/** Begin a pointer drag from a `pointerdown`. No-op for non-primary buttons. */
export function startPointerDrag(e: PointerEvent, spec: PointerDragSpec): void {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const src = e.currentTarget as HTMLElement;
  const startX = e.clientX;
  const startY = e.clientY;
  let dragging = false;
  let ghost: HTMLElement | null = null;

  const under = (x: number, y: number): Element | null => {
    if (ghost) ghost.style.display = 'none';
    const el = document.elementFromPoint(x, y);
    if (ghost) ghost.style.display = '';
    return el;
  };

  const begin = (): void => {
    dragging = true;
    ghost = document.createElement('div');
    ghost.className = 'pp-drag-ghost';
    ghost.textContent = spec.label;
    document.body.appendChild(ghost);
    document.body.classList.add('pp-dragging');
  };

  const onMove = (ev: PointerEvent): void => {
    if (!dragging) {
      if (Math.abs(ev.clientX - startX) < THRESHOLD && Math.abs(ev.clientY - startY) < THRESHOLD) return;
      begin();
    }
    ev.preventDefault();
    if (ghost) {
      ghost.style.left = `${ev.clientX}px`;
      ghost.style.top = `${ev.clientY}px`;
    }
    spec.move?.(under(ev.clientX, ev.clientY), ev.clientX, ev.clientY);
  };

  const finish = (ev: PointerEvent): void => {
    src.removeEventListener('pointermove', onMove);
    src.removeEventListener('pointerup', finish);
    src.removeEventListener('pointercancel', finish);
    try { src.releasePointerCapture(ev.pointerId); } catch { /* not captured */ }
    if (dragging) {
      if (ev.type !== 'pointercancel') spec.drop?.(under(ev.clientX, ev.clientY), ev.clientX, ev.clientY);
      ghost?.remove();
      document.body.classList.remove('pp-dragging');
      // Swallow the click that a pointerup synthesizes, so a drag isn't also a sort.
      const swallow = (c: Event): void => { c.stopPropagation(); c.preventDefault(); };
      src.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => src.removeEventListener('click', swallow, true), 0);
    }
    spec.end?.();
  };

  try { src.setPointerCapture(e.pointerId); } catch { /* unsupported */ }
  src.addEventListener('pointermove', onMove);
  src.addEventListener('pointerup', finish);
  src.addEventListener('pointercancel', finish);
}
