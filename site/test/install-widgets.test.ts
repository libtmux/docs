import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { describe, expect, it } from 'vitest'
import { pickerPaintRules } from '../src/lib/picker-paint'
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
const TS_WORKSPACE = join(SITE_ROOT, 'ts/latest/workspace/index.html')
const GO_WORKSPACE = join(SITE_ROOT, 'go/latest/workspace/index.html')
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

/** TypeScript's library panel, and its workspace CLI's, on the same page. */
const CORE = '.lm-pkg-install__panel[data-manager-scope="ts"]'
const CLI = '.lm-pkg-install__panel[data-manager-scope="ts-workspace"]'

/** Whether `first` comes before `second` in document order. */
const precedes = (first: Element, second: Element) =>
  Boolean(first.compareDocumentPosition(second) & 4 /* DOCUMENT_POSITION_FOLLOWING */)

describe('saved package manager paint', () => {
  it('keys a companion package apart from its library', () => {
    const rules = pickerPaintRules()
    expect(rules).toContain('html[data-pkg-manager-ts-workspace="6"] .lm-pkg-install__panel[data-manager-scope="ts-workspace"]')
    expect(rules).toContain('html[data-pkg-manager-ts="4"] .lm-pkg-install__panel[data-manager-scope="ts"]')
    // The library lists five managers; a seventh is the CLI's alone.
    expect(rules).not.toContain('html[data-pkg-manager-ts="6"]')
  })
})

const describeIfBuilt = SITE_BUILT && existsSync(PORT_HOME) ? describe : describe.skip

describeIfBuilt('package install picker', () => {
  const url = `https://libtmux.org/${SITE_PREFIX}ts/latest/`

  it('shows one command per port, and the first by default', () => {
    const { document } = load(PORT_HOME, url)
    const managers = document.querySelectorAll(`${CORE} .lm-pkg-install__manager`)
    expect(managers.length).toBe(5)
    expect(visibleCommand(document, CORE)).toBe(
      '$ npm install libtmux',
    )
  })

  it('switches the command when a manager is clicked', () => {
    const { document } = load(PORT_HOME, url)
    const pnpm = document.querySelector<HTMLElement>(`${CORE} .lm-pkg-install__manager[data-manager-value="1"]`)!
    pnpm.click()
    expect(pnpm.getAttribute('aria-selected')).toBe('true')
    expect(visibleCommand(document, CORE)).toBe(
      '$ pnpm add libtmux',
    )
  })

  it('remembers the manager per port, and ignores one the port does not have', () => {
    const { window, document } = load(PORT_HOME, url)
    document.querySelector<HTMLElement>(`${CORE} .lm-pkg-install__manager[data-manager-value="3"]`)!.click()
    expect(window.localStorage.getItem('libtmux-docs.package-install.manager.ts')).toBe('3')

    // Restored on the next page.
    const next = load(PORT_HOME, url, { 'libtmux-docs.package-install.manager.ts': '3' })
    expect(visibleCommand(next.document, CORE)).toBe(
      '$ bun add libtmux',
    )

    // Rust has one command; a saved index of 3 must not blank it. The key is
    // per port precisely so this cannot happen, but the guard is what makes a
    // hand-edited or stale value harmless too.
    const stale = load(PORT_HOME, url, { 'libtmux-docs.package-install.manager.ts': '99' })
    expect(visibleCommand(stale.document, CORE)).toBe(
      '$ npm install libtmux',
    )
  })

  it('moves between managers with the arrow keys', () => {
    // happy-dom's KeyboardEvent is structurally its own; `document` is cast to
    // the lib DOM's Document for the rest of this file, so the two disagree
    // about `isTrusted` and friends. The cast is at the boundary between them.
    const arrow = (loaded: Loaded, key: 'ArrowLeft' | 'ArrowRight') => {
      const first = loaded.document.querySelector<HTMLElement>(
        `${CORE} .lm-pkg-install__manager[data-manager-value="0"]`,
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
    expect(visibleCommand(right.document, CORE)).toBe(
      '$ pnpm add libtmux',
    )

    // And wraps backwards off the first tab, so the strip is a loop rather
    // than a dead end at either edge.
    const left = load(PORT_HOME, url)
    arrow(left, 'ArrowLeft')
    expect(visibleCommand(left.document, CORE)).toBe(
      '$ deno add npm:libtmux',
    )
  })

  it('drops the language strip when the page shows one language', () => {
    const { document } = load(PORT_HOME, url)
    expect(document.querySelectorAll('.lm-pkg-install__tab').length).toBe(0)
  })

  it('installs the workspace CLI and the MCP server beside the library', () => {
    const { document } = load(PORT_HOME, url)
    expect(document.querySelectorAll(`${CLI} .lm-pkg-install__manager`).length).toBe(7)
    expect(visibleCommand(document, CLI)).toBe('$ npx -y @libtmux/workspace-cli --help')
    expect(document.querySelector('.lm-mcp-install')?.getAttribute('data-port')).toBe('ts')
  })

  it('keeps the workspace CLI\'s manager apart from the library\'s', () => {
    // Both panels belong to TypeScript. Keyed by port alone, choosing bunx,
    // the CLI's second tab, chose pnpm, the library's second.
    const { window, document } = load(PORT_HOME, url)
    document.querySelector<HTMLElement>(`${CLI} .lm-pkg-install__manager[data-manager-value="1"]`)!.click()
    expect(visibleCommand(document, CLI)).toBe('$ bunx --bun @libtmux/workspace-cli --help')
    expect(visibleCommand(document, CORE)).toBe('$ npm install libtmux')
    expect(window.localStorage.getItem('libtmux-docs.package-install.manager.ts-workspace')).toBe('1')
    expect(window.localStorage.getItem('libtmux-docs.package-install.manager.ts')).toBeNull()

    // Restored on the next page, through <head> as well as the widget.
    const next = load(PORT_HOME, url, { 'libtmux-docs.package-install.manager.ts-workspace': '6' })
    expect(next.document.documentElement.getAttribute('data-pkg-manager-ts-workspace')).toBe('6')
    expect(visibleCommand(next.document, CLI)).toBe('$ bun add -g @libtmux/workspace-cli')
    expect(visibleCommand(next.document, CORE)).toBe('$ npm install libtmux')
  })

  it('places Install between an overview\'s introduction and its first section', () => {
    const mcp = load(TS_MCP, `https://libtmux.org/${SITE_PREFIX}ts/latest/mcp/`).document
    const mcpInstall = mcp.getElementById('install')!
    const intro = [...mcp.querySelectorAll('p')].find((p) => p.textContent?.includes('exposes tmux through'))!
    expect(precedes(intro, mcpInstall)).toBe(true)
    expect(precedes(mcpInstall, mcp.getElementById('start-here')!)).toBe(true)

    const workspace = load(TS_WORKSPACE, `https://libtmux.org/${SITE_PREFIX}ts/latest/workspace/`).document
    const workspaceInstall = workspace.getElementById('install')!
    expect(precedes(workspaceInstall, workspace.getElementById('load-a-workspace-from-the-terminal')!)).toBe(true)
    expect(workspace.querySelector(`${CLI}`)).toBeTruthy()
  })
})

const describeIfGo = SITE_BUILT && existsSync(GO_WORKSPACE) ? describe : describe.skip

describeIfGo('workspace install picker, Go', () => {
  it('builds the unreleased CLI from a clone, above the first section', () => {
    const { document } = load(GO_WORKSPACE, `https://libtmux.org/${SITE_PREFIX}go/latest/workspace/`)
    const panel = '.lm-pkg-install__panel[data-manager-scope="go-workspace"]'
    expect(visibleCommand(document, panel)).toBe(
      '$ git clone https://github.com/libtmux/libtmux-go \\\n    && cd libtmux-go \\\n    && go install ./workspace/cmd/tmux-workspace',
    )
    expect(precedes(document.getElementById('install')!, document.getElementById('load-a-workspace-from-the-terminal')!)).toBe(true)
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
