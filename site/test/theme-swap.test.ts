import { readFileSync } from 'node:fs'
import type { Window } from 'happy-dom'
import { afterEach, describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../src/components/ThemeScript.astro', import.meta.url), 'utf8')
const windows: Window[] = []
afterEach(async () => { for (const win of windows.splice(0)) await win.happyDOM.abort() })

/** A window whose system prefers dark, with the reader's saved choice in storage. */
async function themed(saved: string) {
  const [{ Window }, { default: ts }] = await Promise.all([import('happy-dom'), import('typescript')])
  const win = new Window({ url: 'https://libtmux.org/en/go/latest/reference/tmux-server-sessions/' })
  windows.push(win)
  Object.defineProperty(win, 'matchMedia', {
    value: (query: string) => ({ matches: query.includes('dark'), media: query, addEventListener() {}, removeEventListener() {} }),
  })
  win.localStorage.setItem('color-scheme', saved)
  const inline = /<script is:inline>([\s\S]*?)<\/script>/.exec(source)?.[1]
  const bundled = /<script>([\s\S]*?)<\/script>/.exec(source)?.[1]
  if (!inline || !bundled) throw new Error('ThemeScript lost one of its scripts')
  win.eval(inline)
  win.eval(ts.transpileModule(bundled, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText)
  return win
}

/** Astro's client router: before-swap on the parsed page, then the root attributes replaced by its own. */
function navigate(win: Window) {
  const next = new win.DOMParser().parseFromString('<!doctype html><html lang="en" data-theme="go"><head></head><body></body></html>', 'text/html')
  const event = new win.Event('astro:before-swap')
  Object.assign(event, { newDocument: next })
  win.document.dispatchEvent(event)
  const root = win.document.documentElement
  for (const { name } of [...root.attributes]) root.removeAttribute(name)
  for (const { name, value } of [...next.documentElement.attributes]) root.setAttribute(name, value)
  return root
}

describe('the theme across a client-routed navigation', () => {
  // Every colour keys off data-theme-mode, and tokens.css paints the dark
  // palette on a root without it when the system prefers dark. Astro replaces
  // the root's attributes with the new page's before astro:after-swap runs, so
  // a mode resolved only after the swap flashes the system palette for a frame.
  it.each(['light', 'dark'])('keeps a saved %s mode on the root from the swap onward', async (saved) => {
    const win = await themed(saved)
    expect(win.document.documentElement.getAttribute('data-theme-mode')).toBe(saved)
    const root = navigate(win)
    expect(root.getAttribute('data-theme-mode')).toBe(saved)
    expect(root.getAttribute('data-color-scheme')).toBe(saved)
  })

  it('resolves the system choice against the system preference before the swap', async () => {
    const win = await themed('system')
    const root = navigate(win)
    expect(root.getAttribute('data-color-scheme')).toBe('system')
    expect(root.getAttribute('data-theme-mode')).toBe('dark')
  })
})
