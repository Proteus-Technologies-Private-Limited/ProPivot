// Browser-global build entry (docs/Architecture.md).
// When loaded via <script src="propivot.global.js">, defines window.ProPivot so
// the script-tag consumer can do `new (window.ProPivot)({...})`.

import { ProPivot } from './facade/ProPivot';

declare global {
  interface Window {
    ProPivot: typeof ProPivot;
  }
}

if (typeof window !== 'undefined') {
  (window as Window).ProPivot = ProPivot;
}

export { ProPivot };
export default ProPivot;
