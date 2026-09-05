// @pagefind/default-ui ships no types and no `types`/`exports.types` field
// (verified against its package.json) — this is the ambient declaration
// astro check's own hint suggests, kept in its own file since the search
// call site is the only consumer.
declare module '@pagefind/default-ui' {
  interface PagefindUIOptions {
    element: Element | string
    bundlePath?: string
    showSubResults?: boolean
    [key: string]: unknown
  }

  export class PagefindUI {
    constructor(options: PagefindUIOptions)
  }
}
