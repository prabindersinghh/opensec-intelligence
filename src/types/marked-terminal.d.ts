declare module 'marked-terminal' {
  import type { MarkedExtension } from 'marked'
  export default function Renderer(options?: Record<string, unknown>, highlightOptions?: Record<string, unknown>): void
  export function markedTerminal(options?: Record<string, unknown>, highlightOptions?: Record<string, unknown>): MarkedExtension
}
