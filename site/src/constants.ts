/**
 * The id given to every page's own <h1>.
 *
 * The ported Starlight ToC behavior (components/TableOfContents/starlight-toc.ts)
 * treats the page title as the first entry in the table of contents even
 * though it has no corresponding Markdown heading, so it needs a fixed id to
 * look up rather than one derived from heading text.
 */
export const PAGE_TITLE_ID = '_top'
