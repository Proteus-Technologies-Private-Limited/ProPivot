// Minimal @angular/core surface used by src/wrappers/angular.ts, so the wrapper
// can be type-checked in CI without installing the full Angular toolchain.
declare module '@angular/core' {
  export class EventEmitter<T = unknown> { emit(value?: T): void; }
  export class ElementRef<T = unknown> { nativeElement: T; }
  export function Component(meta: unknown): ClassDecorator;
  export function Input(name?: string): PropertyDecorator;
  export function Output(name?: string): PropertyDecorator;
  export function ViewChild(selector: unknown, opts?: unknown): PropertyDecorator;
  export interface SimpleChanges { [key: string]: unknown; }
  export interface OnChanges { ngOnChanges(changes: SimpleChanges): void; }
  export interface OnDestroy { ngOnDestroy(): void; }
}
