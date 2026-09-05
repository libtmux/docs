import { PORTS } from './ports'

/**
 * The CSS that paints the package picker in the reader's saved language.
 *
 * This lives apart from `PackageInstall.astro` for one reason: it has to be
 * in `<head>`. A `<style>` emitted beside the widget is parsed after it, so
 * the browser is free to paint the server-rendered default first — measured
 * under a throttled CPU, the picker painted `py` at 507ms and corrected
 * itself to the saved `swift` at 1050ms, half a second of the wrong language
 * on screen. The rules were correct; they simply arrived 45 KB too late in
 * the document.
 *
 * `ThemeScript` resolves the saved value onto `<html data-pkg-port>` before
 * any body markup is parsed, and these rules turn that attribute into the
 * painted state. Same shape as the theme gate above it, and as gp-sphinx's.
 *
 * Scoped by `[data-ports~="…"]` so a picker restricted to one language — the
 * port pages render `<PackageInstall ports={[port.slug]} />` — ignores a
 * document-level choice it does not offer and keeps its own default rather
 * than rendering an empty body.
 */
export function pickerPaintRules(): string {
  return PORTS.map((p) => {
    const scope = `html[data-pkg-port="${p.slug}"] .lm-pkg-install[data-ports~="${p.slug}"]`
    return (
      `${scope} .lm-pkg-install__panel{display:none}` +
      `${scope} .lm-pkg-install__panel[data-port="${p.slug}"]{display:block}` +
      `${scope} .lm-pkg-install__tab[aria-selected="true"]` +
      `{color:var(--lm-pkg-install-fg-muted);border-bottom-color:transparent;background:transparent}` +
      `${scope} .lm-pkg-install__tab[data-tab-value="${p.slug}"]` +
      `{color:var(--lm-pkg-install-accent);border-bottom-color:var(--lm-pkg-install-accent);` +
      `background:var(--lm-pkg-install-bg)}`
    )
  }).join('')
}
