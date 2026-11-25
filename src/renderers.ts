import type { Renderer } from './runtime/types.js';

export function domRenderer(mount: Renderer['mount']): Renderer {
  return { mount };
}
