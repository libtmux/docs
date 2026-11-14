import { readFileSync } from 'node:fs'
import { Window } from 'happy-dom'
import { createComponent, renderTemplate } from 'astro/runtime/server/index.js'
import { SymbolIndex, sourceUrl, type ApiSymbol } from '@libtmux/api-model/reference'
import { API_MODELS } from '../src/lib/api-models'
import { loadAstroTemplate, renderAstroTemplate, withoutScope } from './astro-templates'

/**
 * The real `ApiEntry` and `ApiReference` templates rendered for Go (and any port a test names), with the shell around them
 * stubbed: the fixtures of the checks that hold the API reference page to the libtmux.org design system.
 */
export const windows: Window[] = []
/** Close every window a test opened; each file registers it with `afterEach`. */
export const closeWindows = async () => { for (const win of windows.splice(0)) await win.happyDOM.abort() }
export const css = readFileSync(new URL('../src/styles/api.css', import.meta.url), 'utf8')

export const go = API_MODELS.go
export const goIndex = new SymbolIndex(go.symbols, (symbol) => `/en/go/latest/reference/${symbol.slug}/`, 'go')
export const symbolOf = (model: typeof go, id: string) => model.symbols.find((symbol) => symbol.id === id)!

export const options = {
  real: ['components/api/ApiEntry.astro', 'components/api/ApiBadge.astro', 'components/api/SymbolName.astro', 'components/api/ApiMemberList.astro',
    'components/api/ApiPageContents.astro', 'components/api/ApiSignatureParameters.astro'],
  stubs: {
    'components/api/ApiType.astro': '---\nconst { type } = Astro.props\n---\n<span data-type>{type}</span>',
    'components/api/ApiDoc.astro': '---\nconst { text } = Astro.props\n---\n<span data-doc>{text}</span>',
    'components/api/ApiProse.astro': '---\nconst { text } = Astro.props\n---\n<div data-prose>{text}</div>',
  },
  modules: {
    'astro-expressive-code/components': { Code: createComponent(() => renderTemplate``) },
    '../../lib/page-ports-for': { pagePortsFor: async () => [] },
    '../../lib/sidebar': { pageBreadcrumbs: async () => [] },
  },
}

/** The real `ApiEntry` for one declaration. */
export async function entry(symbol: ApiSymbol, props: Record<string, unknown> = {}) {
  const template = await loadAstroTemplate('components/api/ApiEntry.astro', options)
  const win = new Window()
  windows.push(win)
  win.document.body.innerHTML = withoutScope(await renderAstroTemplate(template, { props: { symbol, index: goIndex, port: 'go', member: true, sourceUrl: (entry: ApiSymbol) => sourceUrl(go, entry, '/en/go/latest/reference/'), ...props } }))
  return win.document
}

/** The real `ApiReference` page for one symbol, with the shell around it stubbed. */
export async function page(owner: ApiSymbol, model = go, port = 'go') {
  const template = await loadAstroTemplate('components/api/ApiReference.astro', options)
  const win = new Window()
  windows.push(win)
  win.document.body.innerHTML = withoutScope(await renderAstroTemplate(template, {
    url: `https://libtmux.org/en/${port}/latest/reference/${owner.slug}/`, props: { model, owner },
  }))
  return win.document
}

/** A Go method with everything an entry can show, so the order of its sections is the order under test. */
export function complete(): ApiSymbol {
  const capture = symbolOf(go, 'tmux.Pane.Capture')
  const [signature] = capture.signatures
  return {
    ...capture,
    doc: { ...capture.doc, body: 'Long description.', references: [{ name: '1', text: 'Reference text.' }],
      deprecated: 'Use Pane.CaptureBytes.' },
    signatures: [{ ...signature!, returnsDoc: 'The captured lines.', raises: [{ type: 'CommandError', doc: 'tmux exited nonzero.' }] }],
  } as ApiSymbol
}

