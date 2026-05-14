declare module 'bwip-js' {
  export function toCanvas(canvas: HTMLCanvasElement, options: Record<string, unknown>): void;
  export function toSVG(options: Record<string, unknown>): string;
}
