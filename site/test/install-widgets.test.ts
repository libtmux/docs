import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { describe, expect, it } from 'vitest'
import { SITE_BUILT, SITE_ROOT, SITE_PREFIX, publishedPath } from './site-root'

/**
 * The two install pickers, driven the way a reader drives them.
 *
 * Both are server-rendered down to the last panel and then re-selected by a
 * script, so everything that can go wrong with them goes wrong *after* first
 * paint: a saved choice that names something this page does not have, a
 * prehydrate rule that matches no panel, a strip whose tabs cannot be reached
 * from the keyboard. Static markup checks and a screenshot see none of it.
 *
 * The harness is `code-tabs.test.ts`'s — see that file for why each module
 * script is evaluated in its own scope and why module-only bundles are
 * skipped. CDP will not bind in this environment, which is why this is a DOM
 * rather than a browser.
 */
const PORT_HOME = join(SITE_ROOT, 'ts/latest/index.html')
const TS_MCP = join(SITE_ROOT, 'ts/latest/mcp/index.html')
const PY_MCP = join(SITE_ROOT, 'mcp/index.html')

const isJs = (el: Element) => {
  const type = el.getAttribute('type')
  return !type || type === 'module' || type === 'text/javascript'
}
const isModuleOnly = (source: string) =>
  /\bimport\.meta\b/.test(source) || /\bimport\s*\(/.test(source)

interface Loaded {
  window: Window
  document: Document
}

/** Load a built page into a DOM and run its scripts, with `stored` preset. */
function load(page: string, url: string, stored: Record<string, string> = {}): Loaded {
  const window = new Window({ url })
  const document = window.document as unknown as Document
  for (const [key, value] of Object.entries(stored)) window.localStorage.setItem(key, value)
  document.write(readFileSync(page, 'utf8'))
  const evaluate = (source: string) => window.eval(`(() => {\n${source}\n})()`)
  for (const script of [...document.querySelectorAll('script')]) {
    if (!isJs(script)) continue
    const src = script.getAttribute('src')
    if (!src) {
      const inline = script.textContent ?? ''
      if (!isModuleOnly(inline)) evaluate(inline)
      continue
    }
    if (!src.includes('/_astro/')) continue
    const asset = publishedPath(src)
    if (!existsSync(asset)) continue
    const source = readFileSync(asset, 'utf8')
    if (!isModuleOnly(source)) evaluate(source)
  }
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'))
  return { window, document }
}

/** The one command block a panel is showing, by the rules the page carries. */
function visibleCommand(document: Document, panelSelector: string): string {
  const panel = document.querySelector<HTMLElement>(panelSelector)
  expect(panel, panelSelector).toBeTruthy()
  const active = panel!.getAttribute('data-active-manager') ?? '0'
  const block = panel!.querySelector<HTMLElement>(`.lm-pkg-install__cmd[data-manager="${active}"]`)
  return block?.querySelector('code')?.textContent?.trim() ?? ''
}

const describeIfBuilt = SITE_BUILT && existsSync(PORT_HOME) ? describe : describe.skip

describeIfBuilt('package install picker', () => {
  const url = `https://libtmux.org/${SITE_PREFIX}ts/latest/`

  it('shows one command per port, and the first by default', () => {
    const { document } = load(PORT_HOME, url)
    const managers = document.querySelectorAll('.lm-pkg-install__manager')
    expect(managers.length).toBe(5)
    expect(visibleCommand(document, '.lm-pkg-install__panel[data-port="ts"]')).toBe(
      '$ npm install libtmux',
    )
  })

  it('switches the command when a manager is clicked', () => {
    const { document } = load(PORT_HOME, url)
    const pnpm = document.querySelector<HTMLElement>('.lm-pkg-install__manager[data-manager-value="1"]')!
    pnpm.click()
    expect(pnpm.getAttribute('aria-selected')).toBe('true')
    expect(visibleCommand(document, '.lm-pkg-install__panel[data-port="ts"]')).toBe(
      '$ pnpm add libtmux',
    )
  })

  it('remembers the manager per port, and ignores one the port does not have', () => {
    const { window, document } = load(PORT_HOME, url)
    document.querySelector<HTMLElement>('.lm-pkg-install__manager[data-manager-value="3"]')!.click()
    expect(window.localStorage.getItem('libtmux-docs.package-install.manager.ts')).toBe('3')

    // Restored on the next page.
    const next = load(PORT_HOME, url, { 'libtmux-docs.package-install.manager.ts': '3' })
    expect(visibleCommand(next.document, '.lm-pkg-install__panel[data-port="ts"]')).toBe(
      '$ bun add libtmux',
    )

    // Rust has one command; a saved index of 3 must not blank it. The key is
    // per port precisely so this cannot happen, but the guard is what makes a
    // hand-edited or stale value harmless too.
    const stale = load(PORT_HOME, url, { 'libtmux-docs.package-install.manager.ts': '99' })
    expect(visibleCommand(stale.document, '.lm-pkg-install__panel[data-port="ts"]')).toBe(
      '$ npm install libtmux',
    )
  })

  it('moves between managers with the arrow keys', () => {
    // happy-dom's KeyboardEvent is structurally its own; `document` is cast to
    // the lib DOM's Document for the rest of this file, so the two disagree
    // about `isTrusted` and friends. The cast is at the boundary between them.
    const arrow = (loaded: Loaded, key: 'ArrowLeft' | 'ArrowRight') => {
      const first = loaded.document.querySelector<HTMLElement>(
        '.lm-pkg-install__manager[data-manager-value="0"]',
      )!
      first.dispatchEvent(
        new loaded.window.KeyboardEvent('keydown', {
          key,
          bubbles: true,
          cancelable: true,
        }) as unknown as Event,
      )
    }

    const right = load(PORT_HOME, url)
    arrow(right, 'ArrowRight')
    expect(visibleCommand(right.document, '.lm-pkg-install__panel[data-port="ts"]')).toBe(
      '$ pnpm add libtmux',
    )

    // And wraps backwards off the first tab, so the strip is a loop rather
    // than a dead end at either edge.
    const left = load(PORT_HOME, url)
    arrow(left, 'ArrowLeft')
    expect(visibleCommand(left.document, '.lm-pkg-install__panel[data-port="ts"]')).toBe(
      '$ deno add npm:libtmux',
    )
  })

  it('drops the language strip when the page shows one language', () => {
    const { document } = load(PORT_HOME, url)
    expect(document.querySelectorAll('.lm-pkg-install__tab').length).toBe(0)
  })
})

const describeIfMcp = SITE_BUILT && existsSync(TS_MCP) ? describe : describe.skip

describeIfMcp('MCP install picker', () => {
  const url = `https://libtmux.org/${SITE_PREFIX}ts/latest/mcp/`

  /**
   * Which panel the page would actually show.
   *
   * The selection lives on `<html>` as three attributes and the panel is
   * chosen by a generated stylesheet, so "visible" here means the panel whose
   * client/method/scope match those attributes — the same join the CSS makes.
   * A combination that matches none is the failure this suite exists for: the
   * rule that hides the server-rendered default has already fired by then, so
   * the widget shows nothing at all.
   */
  function selectedPanel(document: Document): HTMLElement | null {
    const html = document.documentElement
    const client = html.getAttribute('data-mcp-install-client')
    const method = html.getAttribute('data-mcp-install-method')
    const scope = html.getAttribute('data-mcp-install-scope')
    return document.querySelector<HTMLElement>(
      `.lm-mcp-install__panel[data-client="${client}"][data-method="${method}"]` +
        `[data-scope="${scope}"][data-cooldown="off"]`,
    )
  }

  it('installs this port\'s server, not Python\'s', () => {
    const { document } = load(TS_MCP, url)
    expect(document.querySelector('.lm-mcp-install')?.getAttribute('data-port')).toBe('ts')
    expect(selectedPanel(document)?.textContent).toContain('npx -y @libtmux/mcp')
  })

  it('renders no cooldown control for a port whose toolchain has none', () => {
    const { document } = load(TS_MCP, url)
    expect(document.querySelectorAll('.lm-mcp-install__cooldown-control').length).toBe(0)
    expect(document.querySelectorAll('.lm-mcp-install__body--settings').length).toBe(0)
  })

  it('keeps a panel visible when another port saved a method this one lacks', () => {
    // The bug this guards: one shared `.method` key meant a reader who chose
    // uvx on /mcp/ arrived here with <html data-mcp-install-method="uvx">,
    // matching no panel selector and no panel on screen.
    const { document } = load(TS_MCP, url, {
      'libtmux-docs.mcp-install.method.py': 'uvx',
      'libtmux-docs.mcp-install.cooldown.enabled': '1',
      'libtmux-docs.mcp-install.cooldown.type': 'days',
    })
    expect(document.documentElement.getAttribute('data-mcp-install-method')).toBe('npx')
    expect(selectedPanel(document)).toBeTruthy()
  })

  it('repairs a saved method this port does not have', () => {
    // The per-port key stops the systematic case; this is the straggler — a
    // stale or hand-edited value. The prehydrate script does not validate
    // (it runs before the widget's markup is parsed), so the attribute is
    // briefly wrong and `syncHtmlAttrs` has to put it back from what the
    // widget actually rendered.
    const { document } = load(TS_MCP, url, { 'libtmux-docs.mcp-install.method.ts': 'uvx' })
    expect(document.documentElement.getAttribute('data-mcp-install-method')).toBe('npx')
    expect(selectedPanel(document)).toBeTruthy()
  })

  it('switches the command when a method is chosen, and remembers it per port', () => {
    const { window, document } = load(TS_MCP, url)
    const global = document.querySelector<HTMLElement>(
      '.lm-mcp-install__tab[data-tab-kind="method"][data-tab-value="global"]',
    )!
    global.click()
    expect(document.documentElement.getAttribute('data-mcp-install-method')).toBe('global')
    expect(window.localStorage.getItem('libtmux-docs.mcp-install.method.ts')).toBe('global')
    expect(selectedPanel(document)?.textContent).toContain('npm install --global @libtmux/mcp')
  })

  it('carries the client between ports, since a client is a fact about the reader', () => {
    const { document } = load(TS_MCP, url, { 'libtmux-docs.mcp-install.client': 'cursor' })
    expect(document.documentElement.getAttribute('data-mcp-install-client')).toBe('cursor')
    expect(selectedPanel(document)).toBeTruthy()
  })
})

const describeIfPyMcp = SITE_BUILT && existsSync(PY_MCP) ? describe : describe.skip

describeIfPyMcp('MCP install picker, Python', () => {
  it('still offers uvx and its cooldown control', () => {
    const { document } = load(PY_MCP, `https://libtmux.org/${SITE_PREFIX}mcp/`)
    expect(document.querySelector('.lm-mcp-install')?.getAttribute('data-port')).toBe('py')
    const methods = [
      ...document.querySelectorAll('.lm-mcp-install__tab[data-tab-kind="method"]'),
    ].map((t) => t.getAttribute('data-tab-value'))
    expect(methods).toEqual(['uvx', 'pipx', 'pip'])
    expect(document.querySelectorAll('.lm-mcp-install__cooldown-control').length).toBe(1)
  })
})
