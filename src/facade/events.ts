// Event system (docs/Architecture.md). Core events plus the full superset the
// Angular wrapper binds, so every consumer handler resolves safely.

export const CORE_EVENTS = [
  'cellclick', 'celldoubleclick', 'dataloaded', 'reportchange',
  'reportcomplete', 'update', 'beforetoolbarcreated',
] as const;

export const SUPERSET_EVENTS = [
  'ready', 'datachanged', 'dataerror', 'datafilecancelled', 'fieldslistopen',
  'fieldslistclose', 'filteropen', 'fullscreen', 'loadingdata',
  'loadinglocalization', 'loadingreportfile', 'localizationerror',
  'localizationloaded', 'openingreportfile', 'querycomplete', 'queryerror',
  'reportfilecancelled', 'reportfileerror', 'reportfileloaded', 'runningquery',
  'aftergriddraw', 'beforegriddraw',
] as const;

export type EventName = (typeof CORE_EVENTS)[number] | (typeof SUPERSET_EVENTS)[number];

export const ALL_EVENTS: string[] = [...CORE_EVENTS, ...SUPERSET_EVENTS];

type Handler = (...args: unknown[]) => void;

export class EventEmitter {
  private handlers = new Map<string, Handler[]>();

  on(event: string, handler: Handler): void {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
  }

  off(event?: string, handler?: Handler): void {
    if (!event) { this.handlers.clear(); return; }
    if (!handler) { this.handlers.delete(event); return; }
    const list = this.handlers.get(event);
    if (list) this.handlers.set(event, list.filter((h) => h !== handler));
  }

  emit(event: string, ...args: unknown[]): void {
    const list = this.handlers.get(event);
    if (!list) return;
    for (const h of list.slice()) {
      try { h(...args); } catch (e) { /* never let one handler break the chain */ console.error(`[ProPivot] handler error for "${event}"`, e); }
    }
  }

  clear(): void { this.handlers.clear(); }
}
