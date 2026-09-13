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
  return PORTS.map((p) => paintPort(p.slug, 'lm-pkg-install') + paintPort(p.slug, 'lm-agent-prompt') + paintManagers(p)).join('')
}

/**
 * The rules that paint one port's saved package manager.
 *
 * The same correction as the language, one level down. `ThemeScript` puts
 * each port's saved manager on `<html data-pkg-manager-<port>>`, and without
 * these rules the panel painted its first manager (npm) and then switched to
 * the saved one (bun) when the widget's script ran. Generated per index the
 * port actually has, so a value left over from a longer list matches nothing
 * and the server-rendered default stays, rather than hiding every command.
 */
function paintManagers(port: (typeof PORTS)[number]): string {
  if (port.installs.length < 2) return ''
  return port.installs
    .map((_, i) => {
      const scope = `html[data-pkg-manager-${port.slug}="${i}"] .lm-pkg-install__panel[data-port="${port.slug}"]`
      return (
        `${scope} .lm-pkg-install__cmd{display:none}` +
        `${scope} .lm-pkg-install__cmd[data-manager="${i}"]{display:block}` +
        `${scope} .lm-pkg-install__manager[aria-selected="true"]` +
        `{color:var(--lm-pkg-install-fg-muted);border-color:transparent}` +
        `${scope} .lm-pkg-install__manager[data-manager-value="${i}"]` +
        `{color:var(--lm-pkg-install-accent);border-color:var(--lm-pkg-install-accent)}`
      )
    })
    .join('')
}

/**
 * The rules for one port in one widget family.
 *
 * Both widgets remember the reader's language under the same key and both
 * server-render a panel per port, so both need the same three corrections
 * before first paint: hide every panel, show this port's, and move the tab
 * highlight off the server-rendered default onto this port. Generated per
 * family rather than written twice, because a family that drifts out of this
 * list does not fail, it just flickers, which is the bug this file exists to
 * prevent and the one nobody files.
 */
function paintPort(slug: string, family: string): string {
  const scope = `html[data-pkg-port="${slug}"] .${family}[data-ports~="${slug}"]`
  // The package picker keeps hidden panels in its grid so its height holds;
  // see PackageInstall.astro. It shows one with `inherit`, not `visible`: a
  // visible child paints through a hidden ancestor, so during the fonts gate
  // the saved panel painted alone before the rest of the page.
  const [hide, show] = family === 'lm-pkg-install'
    ? ['visibility:hidden', 'visibility:inherit']
    : ['display:none', 'display:block']
  return (
    `${scope} .${family}__panel{${hide}}` +
    `${scope} .${family}__panel[data-port="${slug}"]{${show}}` +
    `${scope} .${family}__tab[aria-selected="true"]` +
    `{color:var(--${family}-fg-muted);border-bottom-color:transparent;background:transparent}` +
    `${scope} .${family}__tab[data-tab-value="${slug}"]` +
    `{color:var(--${family}-accent);border-bottom-color:var(--${family}-accent);` +
    `background:var(--${family}-bg)}`
  )
}
