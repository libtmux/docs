import { describe, expect, it } from 'vitest'
import { parseApiProse, type ApiSymbol } from '@libtmux/api-model/reference'
import { extractCommonLisp } from '../../packages/api-model/src/languages/lisp.ts'
import { pageSlug } from '../../packages/api-model/src/prose.ts'
import { groupDirectory } from '../src/lib/api-directory'
import { PORT_BY_SLUG, referenceUrl } from '../src/lib/ports'
import { productApiIndex } from '../src/lib/product-api'
import { formKind, writtenForm } from '../src/lib/symbol-form'
import { defaultVersionFor } from '../src/lib/versions'

/**
 * `session` and `window` are each a class and a function in libtmux-lisp. The class page is `…-type` and the
 * function page `…-function`; a bare `libtmux:window` links to the class, so a directory writes the accessor
 * `libtmux:window/function`. The chip drops the suffix from its label, so its link is all that tells the pages
 * apart: a chip on the pane page that went to the Window class would send the reader to the wrong page.
 */
const revision = '1'.repeat(40)
const where = (file: string, line: number) => ({ file, line })
const docs = (summary: string, body?: string) => ({ summary, ...(body ? { body } : {}) })
const fn = (id: string, name: string, signature: string, methods?: { signature: string; qualifiers: string[]; specializers: string[] }[]) => ({
  id, name, kind: 'function', signature, modifiers: [], generic: Boolean(methods), ...(methods ? { methods } : {}),
  documentation: docs(`Call ${name.toUpperCase()}.`), source: where('src/model.lisp', 10),
})

const directory = (name: string, entry: string) => `#### What is on here

**Finding ${name}s.** \`libtmux:fetch-${name}s\` captures a snapshot and \`${entry}\` returns the ${name} of a pane or a window link.

\`libtmux:fetch-${name}s\`, \`${entry}\` and \`libtmux:${name}s\`

**Reading what a capture recorded.** \`libtmux:name\` returns the captured name.

\`libtmux:name\` and \`libtmux:id\`

**Creating and removing.** \`libtmux:kill-${name}\` deletes exactly the captured ${name}.

\`libtmux:kill-${name}\`
`

/** The shape of the libtmux-lisp documentation export: package-qualified ids, `/function` and `/type` where a class and a function share a name. */
const artifact = {
  schema: 'libtmux.lisp.api/1', port: 'lisp',
  library: { version: '0.1.0' },
  runtime: { implementation: 'SBCL', implementationVersion: '2.6.10', asdfVersion: '3.3.7' },
  source: {
    repository: 'libtmux/libtmux-lisp', revision, dirty: false,
    files: ['src/json.lisp', 'src/model.lisp', 'src/package.lisp', 'src/query.lisp', 'src/workspace-cli.lisp', 'src/workspace.lisp', 'tools/documentation.lisp']
      .map((path, n) => ({ path, sha256: String(n).repeat(64) })),
  },
  exporter: { name: 'libtmux.documentation', version: 1, revision, dirty: false },
  packages: [
    {
      name: 'libtmux', system: 'libtmux', product: 'core',
      documentation: docs('Native tmux observations.'), source: where('src/package.lisp', 1),
      symbols: [
        { id: 'libtmux:entity', name: 'entity', kind: 'class', modifiers: [], documentation: docs('An owned observation.'), source: where('src/model.lisp', 10) },
        { id: 'libtmux:session/type', name: 'session', kind: 'class', modifiers: [], supertypes: ['libtmux:entity'],
          documentation: docs('A captured physical tmux session.', directory('session', 'libtmux:session/function')), source: where('src/model.lisp', 25) },
        { id: 'libtmux:window/type', name: 'window', kind: 'class', modifiers: [], supertypes: ['libtmux:entity'],
          documentation: docs('A physical window shared by zero or more captured links.', directory('window', 'libtmux:window/function')), source: where('src/model.lisp', 26) },
        { id: 'libtmux:pane', name: 'pane', kind: 'class', modifiers: [], supertypes: ['libtmux:entity'],
          documentation: docs('A physical pane belonging to one captured window.', directory('pane', 'libtmux:window/function')), source: where('src/model.lisp', 27) },
        fn('libtmux:session/function', 'session', '(session entity)', [{ signature: '(session (entity window-link))', qualifiers: [], specializers: ['libtmux:entity'] }]),
        fn('libtmux:window/function', 'window', '(window entity)', [{ signature: '(window (entity pane))', qualifiers: [], specializers: ['libtmux:pane'] }]),
        fn('libtmux:sessions', 'sessions', '(sessions snapshot)'), fn('libtmux:windows', 'windows', '(windows observation)'),
        fn('libtmux:panes', 'panes', '(panes observation)'),
        fn('libtmux:fetch-sessions', 'fetch-sessions', '(fetch-sessions client)'), fn('libtmux:fetch-windows', 'fetch-windows', '(fetch-windows client)'),
        fn('libtmux:fetch-panes', 'fetch-panes', '(fetch-panes client)'),
        fn('libtmux:name', 'name', '(name entity)'), fn('libtmux:id', 'id', '(id entity)'),
        fn('libtmux:kill-session', 'kill-session', '(kill-session client session)'), fn('libtmux:kill-window', 'kill-window', '(kill-window client window)'),
        fn('libtmux:kill-pane', 'kill-pane', '(kill-pane client pane)'),
      ],
    },
    { name: 'libtmux.json', system: 'libtmux/json', product: 'core', documentation: docs('Bounded JSON.'), source: where('src/json.lisp', 1),
      symbols: [fn('libtmux.json:read-filter', 'read-filter', '(read-filter source)')] },
    { name: 'libtmux.query', system: 'libtmux/query', product: 'core', documentation: docs('Native queries.'), source: where('src/query.lisp', 1),
      symbols: [fn('libtmux.query:compile-filter', 'compile-filter', '(compile-filter model form)')] },
    { name: 'libtmux.workspace', system: 'libtmux/workspace', product: 'workspace', documentation: docs('Owned workspaces.'), source: where('src/workspace.lisp', 1),
      symbols: [fn('libtmux.workspace:apply-workspace', 'apply-workspace', '(apply-workspace client workspace)')] },
    { name: 'libtmux.workspace.cli', system: 'libtmux/workspace/cli', product: 'workspace', documentation: docs('Workspace command adapter.'), source: where('src/workspace-cli.lisp', 1),
      symbols: [fn('libtmux.workspace.cli:main', 'main', '(main)')] },
  ],
}

/** The slug rule of scripts/gen-api-model.mjs for ids that do not collide: the page slug of the public id. */
const model = extractCommonLisp(artifact, revision)
for (const symbol of model.symbols) symbol.slug = pageSlug(symbol.publicId ?? symbol.id)
const version = defaultVersionFor('lisp')
const index = productApiIndex(model, version)
const reference = referenceUrl(PORT_BY_SLUG.lisp, version)
const symbolOf = (id: string) => model.symbols.find((symbol) => symbol.id === id) as ApiSymbol
const chipOf = (text: string, owner: string) => index.docSpans(`\`${text}\``, symbolOf(owner)).find((span) => span.kind === 'ref')

describe('a directory chip for a function that shares its name with a class', () => {
  it('has a function page and a class page at different addresses', () => {
    for (const name of ['session', 'window']) {
      expect(symbolOf(`libtmux:${name}/function`).slug).toBe(`libtmux-${name}-function`)
      expect(symbolOf(`libtmux:${name}/type`).slug).toBe(`libtmux-${name}-type`)
    }
  })

  it.each([
    ['libtmux:session/function', 'libtmux:session/type', 'libtmux-session-function'],
    ['libtmux:window/function', 'libtmux:window/type', 'libtmux-window-function'],
    ['libtmux:window/function', 'libtmux:pane', 'libtmux-window-function'],
  ])('links %s on the page of %s to the function page %s', (reference_, owner, slug) => {
    const span = chipOf(reference_, owner)
    expect(span?.link?.symbol?.id).toBe(reference_)
    expect(span?.link?.symbol?.kind).toBe('function')
    expect(span?.link?.href).toBe(`${reference}${slug}/`)
    expect(span?.link?.href).not.toMatch(/-type\/$/)
  })

  it('reads as the bare name, so the link alone separates it from the class', () => {
    const span = chipOf('libtmux:window/function', 'libtmux:pane')
    const target = span?.link?.symbol as ApiSymbol
    expect(writtenForm({ lang: 'lisp', kind: formKind('lisp', target, undefined), symbol: target, owner: undefined, label: span!.label, chip: true }))
      .toBe('libtmux:window')
  })

  it('is the reason a directory spells the suffix: the bare name links to the class page', () => {
    for (const name of ['session', 'window']) expect(chipOf(`libtmux:${name}`, 'libtmux:pane')?.link?.href).toBe(`${reference}libtmux-${name}-type/`)
  })

  it('links every reference of a folded directory to the page of the symbol it names', () => {
    for (const owner of ['libtmux:session/type', 'libtmux:window/type', 'libtmux:pane']) {
      const [folded] = groupDirectory(parseApiProse(symbolOf(owner).doc?.body ?? ''), 'lisp').filter((block) => block.kind === 'directory')
      expect(folded?.kind, owner).toBe('directory')
      const refs = folded!.kind === 'directory' ? folded!.rows.flatMap((row) => row.groups.flatMap((group) => group.refs)) : []
      expect(refs.length, owner).toBeGreaterThanOrEqual(3)
      for (const ref of refs) {
        const id = ref.replaceAll('`', '')
        const span = chipOf(id, owner)
        expect(span?.link?.symbol?.id, `${owner}: ${id}`).toBe(id)
        expect(span?.link?.href, `${owner}: ${id}`).toBe(`${reference}${pageSlug(id)}/`)
      }
    }
  })
})
