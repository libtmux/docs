import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { experimental_AstroContainer } from 'astro/container'
import { Window } from 'happy-dom'
import { describe, expect, it, vi } from 'vitest'
import { extractProject, membersOf, navSidecarFor, SymbolIndex } from '@libtmux/api-model'
import { API_MODELS, ownersOf } from '../src/lib/api-models'
import { membersByTypeFor, navTreeFor, referenceTreeFor } from '../src/lib/api-tree'
import { hasScalarMembers } from '../src/lib/api-sections'
import { symbolMarkdown } from '../src/lib/symbol-markdown'
import { linkTmuxDoc } from '../src/lib/tmux-links'
import { symbolPreview } from '../src/lib/link-preview'
import { GET as referenceMarkdown } from '../src/pages/reference/[...slug].md'
import { PORT_ROOT } from '../src/lib/site-root'

vi.mock('astro:content', () => ({ getCollection: () => { throw new Error('Core Markdown must use its API model') } }))

const model = API_MODELS.ts
const hrefFor = (symbol: (typeof model.symbols)[number]) => `/en/ts/latest/reference/${symbol.slug}/`
const index = new SymbolIndex(model.symbols, hrefFor, 'ts')
const families = {
  ResizeAdjustmentDirection: [['Up', '"UP"'], ['Down', '"DOWN"'], ['Left', '"LEFT"'], ['Right', '"RIGHT"']],
  WindowDirection: [['Before', '"BEFORE"'], ['After', '"AFTER"']],
  PaneDirection: [['Above', '"ABOVE"'], ['Below', '"BELOW"'], ['Right', '"RIGHT"'], ['Left', '"LEFT"']],
  OptionScope: [['Server', '"server"'], ['Session', '"session"'], ['Window', '"window"'], ['Pane', '"pane"']],
}

describe('TypeScript named values', () => {
  it.each(['latest', 'v0.1.0'])('links member rows through the production %s Markdown endpoint', async (version) => {
    vi.stubEnv('LIBTMUX_DOCS_VERSION', version)
    try {
      // API handlers only read props and site; no Astro request runtime is needed.
      const response = await referenceMarkdown({
        props: { port: 'ts', id: 'constants.ResizeAdjustmentDirection' }, site: new URL('https://libtmux.org'),
      } as unknown as Parameters<typeof referenceMarkdown>[0])
      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8')
      const markdown = await response.text()
      for (const [name, value] of families.ResizeAdjustmentDirection) {
        expect(markdown).toContain(`| [\`${name}\`](${PORT_ROOT}/ts/${version}/reference/constants-resizeadjustmentdirection-${name.toLowerCase()}/) | \`${value}\` |  |`)
      }
      const missing = await referenceMarkdown({ props: { port: 'ts', id: 'constants.Missing' } } as unknown as Parameters<typeof referenceMarkdown>[0])
      expect(missing.status).toBe(404)
    } finally { vi.unstubAllEnvs() }
  })

  it('publishes standalone constant-object members in initial and lazy navigation', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'typescript-constant-nav-'))
    try {
      writeFileSync(join(directory, 'constants.ts'), 'export const Direction = { Up: "UP" } as const;')
      const model = await extractProject({ port: 'ts', root: directory })
      const owner = model.symbols.find((symbol) => symbol.id === 'constants.Direction')!
      expect(owner.kind).toBe('constant')
      expect(ownersOf(model).map((symbol) => symbol.id)).toContain(owner.id)
      expect(membersByTypeFor('ts', model).get(owner.id)).toEqual([
        { id: 'constants.Direction.Up', name: 'Up', slug: 'constants-direction-up' },
      ])
      const nav = navSidecarFor('ts', model, { buckets: [{ id: 'constants', label: 'Constants', match: { kind: 'id', is: owner.id } }] })
      const tree = referenceTreeFor('ts', model, navTreeFor(model, nav))
      expect(tree.buckets[0].types[0]).toMatchObject({ id: owner.id, kind: 'constant', m: 1, category: 'members' })
      // The id keeps the file the constant is written in; the names a reader sees are TypeScript's own spelling.
      expect(tree.members[owner.id]).toEqual([
        ['Up', 'constants-direction-up', 'constants.Direction.Up', 'property', 'members', '', 'Direction.Up', 'Direction.Up'],
      ])
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })

  for (const [name, values] of Object.entries(families)) {
    it(`keeps ${name} members in native order across the model, navigation and Markdown`, () => {
      const owner = model.symbols.find((symbol) => symbol.id === `constants.${name}`)!
      expect(owner).toBeDefined()
      expect(owner.kind).toBe('typealias')
      expect(owner.modifiers).not.toContain('overload')
      expect(owner.slug).toBe(`constants-${name.toLowerCase()}`)
      expect(owner.declarations?.map((declaration) => declaration.kind)).toEqual(['constant', 'typealias'])
      const members = membersOf(model, owner)
      expect(members.map((symbol) => [symbol.name, symbol.value])).toEqual(values)
      expect(hasScalarMembers(owner, members)).toBe(true)
      expect(membersByTypeFor('ts', model).get(owner.id)?.map((symbol) => symbol.name)).toEqual(values.map(([name]) => name))
      const markdown = symbolMarkdown({ model, symbol: owner, index, hrefFor })
      expect(markdown).toContain('| Name | Value | Description |')
      for (const member of members) {
        expect(member.source).toMatchObject({
          file: 'packages/libtmux/src/constants.ts', revision: model.revision, extractedRevision: model.revision,
        })
        expect(index.resolve(member.name, 'any', owner)?.href).toBe(hrefFor(member))
        expect(markdown).toContain(`| [\`${member.name}\`](${hrefFor(member)}) | \`${member.value}\` |  |`)
        expect(symbolMarkdown({ model, symbol: member, index, hrefFor })).toContain(`${member.publicId} = ${member.value}`)
        expect(symbolPreview(model, member, 'latest')).toMatchObject({
          signature: `${member.name} = ${member.value}`, signatureLanguage: 'ts',
        })
      }
    })
  }

  it('preserves both declaration source identities and resolves the real contextual Up mention', () => {
    const owner = model.symbols.find((symbol) => symbol.id === 'constants.ResizeAdjustmentDirection')!
    expect(owner.source.line).toBe(13)
    expect(owner.declarations?.map((declaration) => declaration.source.line)).toEqual([1, 13])
    const up = index.linkText(owner.doc!.body!, owner).find((span) => span.kind === 'ref' && span.label === 'Up')
    expect(up).toMatchObject({ link: { href: '/en/ts/latest/reference/constants-resizeadjustmentdirection-up/' } })
  })
})

const astroRequire = createRequire(realpathSync(new URL('../node_modules/astro/package.json', import.meta.url)))
async function scalarTableComponent() {
  const { transform } = await import(astroRequire.resolve('@astrojs/compiler-rs'))
  const compiled = new Map<string, string>()
  for (const name of ['ApiDoc', 'ApiScalarMembers']) {
    const file = new URL(`../src/components/api/${name}.astro`, import.meta.url)
    const result = await transform(readFileSync(file, 'utf8'), { filename: file.pathname, internalURL: 'astro/compiler-runtime', resultScopedSlot: true, resolvePath: (specifier: string) => specifier })
    expect(result.diagnostics.filter((item: { severity: string }) => item.severity === 'error')).toEqual([])
    const linker = 'data:text/javascript,export const linkTmuxDoc = globalThis.__scalarMemberDocLinker'
    let code = result.code.replaceAll('"astro/compiler-runtime"', JSON.stringify(pathToFileURL(astroRequire.resolve('astro/compiler-runtime')).href))
      .replaceAll('"../../lib/tmux-links"', JSON.stringify(linker))
    for (const [dependency, url] of compiled) code = code.replaceAll(`"./${dependency}.astro"`, JSON.stringify(url))
    compiled.set(name, `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
  }
  return (await import(/* @vite-ignore */ compiled.get('ApiScalarMembers')!)).default
}

it('renders linked scalar values as a semantic table with exact literal text', async () => {
  const owner = model.symbols.find((symbol) => symbol.id === 'constants.ResizeAdjustmentDirection')!
  const members = membersOf(model, owner)
  const window = new Window()
  vi.stubGlobal('__scalarMemberDocLinker', linkTmuxDoc)
  try {
    const container = await experimental_AstroContainer.create()
    window.document.body.innerHTML = await container.renderToString(await scalarTableComponent(), { props: { owner, members, index, hrefFor } })
    expect([...window.document.querySelectorAll('thead th[scope="col"]')].map((cell) => cell.textContent)).toEqual(['Name', 'Value', 'Description'])
    expect(window.document.querySelector('caption')?.textContent).toBe('ResizeAdjustmentDirection constant object properties')
    const rows = [...window.document.querySelectorAll('tbody tr')]
    expect(rows).toHaveLength(4)
    for (const [position, row] of rows.entries()) {
      const member = members[position]
      expect(row.id).toBe(`member-${member.publicId}`)
      expect(row.querySelector('th[scope="row"] a')?.getAttribute('href')).toBe(hrefFor(member))
      expect(row.querySelector('code')?.textContent).toBe(member.value)
      expect(row.querySelector('td:last-child')?.textContent).toBe('')
    }
  } finally { await window.happyDOM.abort(); vi.unstubAllGlobals() }
})
