import type { ApiModel, ApiSymbol, DocBlock, Signature } from '../model.ts'
import { exportGroupsNav } from '../nav-sidecar.ts'
import { sourceUrl } from '../products.ts'

interface NativeSource { file: string; revision: string; line?: number }
interface NativeLink { text: string; href: string; target?: string }
interface NativeInstance {
  raw: string
  markdown: string
  doc: string | null
  references: NativeLink[]
  source: NativeSource
}
interface NativeSymbol extends Omit<ApiSymbol, 'doc' | 'parent' | 'source'> {
  doc: DocBlock | null
  parent: string | null
  source: NativeSource
  instances?: NativeInstance[]
}
interface HashedInput { path: string; sha256: string }
interface HaskellArtifact {
  schema: string
  port: string
  repo: string
  revision: string
  compiler: string
  haddock: string
  component: string
  package: { name: string; version: string; exposedModules: string[] }
  nativeProvenance: {
    files: HashedInput[]
    exporter: {
      name: string; version: number; repository: string; revision: string; path: string; sha256: string
      build: { compiler: string; cabal: string; unit: string; platform: string }
      interfaceStream: string
      nativeArtifacts: HashedInput[]
    }
  }
  modules: { name: string; groups: { title: string; members: string[] }[] }[]
  symbols: NativeSymbol[]
}

const COMMIT = /^[a-f0-9]{40}$/
const HASH = /^[a-f0-9]{64}$/
const QUALIFIED_MODULES = ['LibTmux.Id', 'LibTmux.Value', 'LibTmux.Version']
const VERSION = /^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*))+$/

function check(condition: unknown, reason: string): asserts condition {
  if (!condition) throw new Error(`Invalid Haskell documentation artifact: ${reason}`)
}

function hashedInputs(inputs: HashedInput[], expected: string[], label: string): void {
  check(Array.isArray(inputs) && inputs.length === expected.length, `incomplete ${label}`)
  const remaining = new Set(expected)
  for (const input of inputs) {
    check(input && typeof input.path === 'string' && remaining.delete(input.path) &&
      typeof input.sha256 === 'string' && HASH.test(input.sha256), `invalid or repeated ${label}`)
  }
}

/** Preserve the native destination; resolve only explicitly identified public declarations. */
function validateLink(link: NativeLink, byId: Map<string, NativeSymbol>): void {
  check(link && typeof link.text === 'string' && link.text.length && typeof link.href === 'string', 'missing native link')
  if (link.target !== undefined) {
    const target = byId.get(link.target)
    check(target, `unknown public link target ${link.target}`)
    const [module, anchor] = link.target.split('#')
    const expected = `${module.replaceAll('.', '-')}.html${anchor ? `#${anchor}` : ''}`
    check(link.href === expected, `native destination differs from ${link.target}`)
  } else {
    let url: URL
    try { url = new URL(link.href) } catch { throw new Error(`Invalid Haskell native URL: ${link.href}`) }
    check(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password, `unsafe native URL ${link.href}`)
  }
}

function validateSignature(signature: Signature, symbol: NativeSymbol, byId: Map<string, NativeSymbol>): void {
  check(typeof signature.raw === 'string' && signature.raw.length && Array.isArray(signature.params) &&
    signature.params.length === 0 && Array.isArray(signature.nativeSpans) && signature.nativeSpans.length, `missing native signature for ${symbol.id}`)
  const spans = signature.nativeSpans
  check(spans.every((span) => span && typeof span.text === 'string' && span.text.length &&
    (span.declaration === undefined || span.declaration === true) && (span.keyword === undefined || span.keyword === true)),
  `invalid native signature spans for ${symbol.id}`)
  check(spans.map((span) => span.text).join('') === signature.raw, `native signature text differs for ${symbol.id}`)
  const declarations = spans.filter((span) => span.declaration)
  check(declarations.length === 1 && declarations[0].text === symbol.name && !declarations[0].href && !declarations[0].target,
    `missing declaration marker for ${symbol.id}`)
  for (const span of spans) {
    check(span.target === undefined || span.href !== undefined, `link target has no destination in ${symbol.id}`)
    if (span.href !== undefined) validateLink(span as NativeLink, byId)
  }
  check(signature.methodKind === undefined || signature.methodKind === 'constructor', `unsupported method kind for ${symbol.id}`)
}

/** Adapt the qualified GHC 9.14/Haddock public profile without parsing Haskell source. */
export function extractHaskellArtifact(input: unknown, expectedRevision?: string): ApiModel {
  check(input && typeof input === 'object', 'missing document')
  const artifact = structuredClone(input) as HaskellArtifact
  check(artifact.schema === 'libtmux.haskell-api/1' && artifact.port === 'haskell' &&
    artifact.repo === 'libtmux/libtmux-haskell' && typeof artifact.revision === 'string' && COMMIT.test(artifact.revision),
  'unsupported schema or source identity')
  check(!expectedRevision || artifact.revision === expectedRevision, 'source revision differs from the selected checkout')
  check(artifact.compiler === '9.14.1' && artifact.haddock === '2.33.0' && artifact.component === 'lib:libtmux-haskell',
    'unsupported native tool or component profile')
  check(artifact.package?.name === 'libtmux-haskell' && VERSION.test(artifact.package.version) &&
    Array.isArray(artifact.package.exposedModules) && artifact.package.exposedModules.length, 'invalid Cabal package identity')
  const modules = artifact.package.exposedModules
  check(modules.length === QUALIFIED_MODULES.length && modules.every((module, index) => module === QUALIFIED_MODULES[index]),
    'unqualified exposed module profile')
  check(Array.isArray(artifact.modules) && artifact.modules.length === modules.length &&
    artifact.modules.every((module, index) => module?.name === modules[index] && Array.isArray(module.groups)),
  'native modules differ from the configured public modules')
  const exporter = artifact.nativeProvenance?.exporter
  check(exporter?.name === 'Haddock public interface export' && exporter.version === 1 && exporter.repository === 'libtmux/docs' &&
    typeof exporter.revision === 'string' && COMMIT.test(exporter.revision) &&
    exporter.path === 'packages/api-model/scripts/export-haskell.py' && HASH.test(exporter.sha256), 'missing committed producer identity')
  check(exporter.build?.compiler === `ghc-${artifact.compiler}` && exporter.build.cabal === '3.18.2.0' &&
    exporter.build.unit === `${artifact.package.name}-${artifact.package.version}-inplace` &&
    typeof exporter.build.platform === 'string' && /^[\w]+-[\w]+$/.test(exporter.build.platform) &&
    ['stdout', 'stderr'].includes(exporter.interfaceStream), 'invalid configured native build')
  const sourceFiles = modules.map((module) => `src/${module.replaceAll('.', '/')}.hs`)
  hashedInputs(artifact.nativeProvenance.files, ['.tool-versions', 'cabal.project', 'libtmux-haskell.cabal', ...sourceFiles], 'source inputs')
  hashedInputs(exporter.nativeArtifacts, ['interface.haddock', 'interface.json',
    ...modules.flatMap((module) => [`${module.replaceAll('.', '-')}.html`, `src/${module}.html`])], 'native inputs')
  check(Array.isArray(artifact.symbols) && artifact.symbols.length, 'no public declarations')
  const byId = new Map<string, NativeSymbol>()
  for (const symbol of artifact.symbols) {
    check(symbol && typeof symbol.id === 'string' && !byId.has(symbol.id), 'missing or repeated public identity')
    check(symbol.apiScope === 'exported' && symbol.product === 'core' && symbol.package === artifact.package.name,
      `nonpublic or unrecognized package declaration ${symbol.id}`)
    check(['module', 'typealias', 'function', 'property'].includes(symbol.kind) && typeof symbol.name === 'string' &&
      Array.isArray(symbol.modifiers) && symbol.modifiers.every((modifier) => modifier === 'opaque') &&
      symbol.modifiers.length <= 1 && Array.isArray(symbol.signatures), `unsupported declaration shape ${symbol.id}`)
    if (symbol.kind === 'module') {
      check(modules.includes(symbol.id) && symbol.name === symbol.id && symbol.parent === null &&
        symbol.signatures.length === 0 && symbol.modifiers.length === 0, `invalid public module ${symbol.id}`)
    } else {
      check(typeof symbol.namespace === 'string' && modules.includes(symbol.namespace) &&
        /^[A-Za-z_][\w']*$/.test(symbol.name) && symbol.qualifiedName === `${symbol.namespace}.${symbol.name}` &&
        symbol.id === `${symbol.namespace}#${symbol.kind === 'typealias' ? 't' : 'v'}:${symbol.name}` &&
        symbol.publicId === symbol.id && symbol.signatures.length === 1, `invalid public declaration identity ${symbol.id}`)
    }
    const module = symbol.kind === 'module' ? symbol.id : symbol.namespace!
    check(symbol.source?.file === `src/${module.replaceAll('.', '/')}.hs` && symbol.source.revision === artifact.revision &&
      (symbol.source.line === undefined || (Number.isSafeInteger(symbol.source.line) && symbol.source.line > 0)),
    `source differs from the public declaration ${symbol.id}`)
    check(symbol.doc === null || (symbol.doc && typeof symbol.doc.summary === 'string' &&
      (symbol.doc.body === undefined || typeof symbol.doc.body === 'string')), `invalid authored documentation ${symbol.id}`)
    byId.set(symbol.id, symbol)
  }
  check(modules.every((module) => byId.get(module)?.kind === 'module'), 'missing public module declaration')
  const constructorOwners = new Set(artifact.symbols.filter((symbol) => symbol.kind === 'function' &&
    symbol.signatures[0]?.methodKind === 'constructor').map((symbol) => symbol.parent))
  for (const symbol of artifact.symbols) {
    if (symbol.kind === 'module') continue
    const parent = byId.get(symbol.parent ?? '')
    const constructor = symbol.signatures[0].methodKind === 'constructor'
    check(parent && (parent.kind === 'module' ? parent.id === symbol.namespace && symbol.kind !== 'property' && !constructor
      : parent.kind === 'typealias' && !parent.modifiers.includes('opaque') && parent.namespace === symbol.namespace &&
        ((symbol.kind === 'property' && !constructor) || (symbol.kind === 'function' && constructor))), `invalid public parent for ${symbol.id}`)
    if (symbol.kind === 'typealias') {
      // This producer profile exports scalar data heads, not aliases or hidden representations.
      check(symbol.signatures[0].raw === `data ${symbol.name}` && Array.isArray(symbol.instances),
        `unsupported type representation or missing instances for ${symbol.id}`)
      check(symbol.modifiers.includes('opaque') === !constructorOwners.has(symbol.id), `opaque status differs for ${symbol.id}`)
    } else check(symbol.modifiers.length === 0, `opaque non-type ${symbol.id}`)
    validateSignature(symbol.signatures[0], symbol, byId)
  }
  const model: ApiModel = {
    port: 'haskell', repo: artifact.repo, revision: artifact.revision,
    extractor: `@libtmux/api-model@0.0.1 (${exporter.name} v${exporter.version})`,
    nativeProvenance: artifact.nativeProvenance,
    sources: [{ product: 'core', package: artifact.package.name, version: artifact.package.version,
      repo: artifact.repo, revision: artifact.revision, extractedRevision: artifact.revision }],
    exportGroups: artifact.modules.flatMap((module) => module.groups.map((group) => ({ owner: module.name, ...group }))),
    symbols: [],
  }
  model.symbols = artifact.symbols.map((native): ApiSymbol => {
    const source = { ...native.source, repo: artifact.repo, extractedRevision: artifact.revision }
    const references: NonNullable<ApiSymbol['references']> = []
    const refer = (target: string) => {
      if (!references.some((reference) => reference.target === target)) {
        references.push({ target, kind: byId.get(target)!.kind === 'typealias' ? 'type' : 'reference' })
      }
    }
    for (const span of native.signatures.flatMap((signature) => signature.nativeSpans ?? [])) if (span.target) refer(span.target)
    let doc = native.doc ?? undefined
    if (native.instances !== undefined) {
      check(native.kind === 'typealias' && Array.isArray(native.instances), `instances on a non-type ${native.id}`)
      const heads = new Set<string>()
      const items = native.instances.map((instance) => {
        check(instance && typeof instance.raw === 'string' && instance.raw.startsWith('instance ') && !heads.has(instance.raw) &&
          typeof instance.markdown === 'string' && instance.markdown.startsWith('instance ') &&
          (instance.doc === null || typeof instance.doc === 'string') && Array.isArray(instance.references),
        `invalid native instance for ${native.id}`)
        heads.add(instance.raw)
        check(instance.source?.file === native.source.file && instance.source.revision === artifact.revision &&
          (instance.source.line === undefined || (Number.isSafeInteger(instance.source.line) && instance.source.line > 0)),
        `instance source differs for ${native.id}`)
        for (const link of instance.references) {
          validateLink(link, byId)
          if (link.target) refer(link.target)
        }
        // Only simple class/type heads are qualified; owner and display must agree.
        const [typeclass, owner] = instance.references
        check(instance.references.length === 2 && !typeclass.target && /^[A-Z][\w']*$/.test(typeclass.text) &&
          owner.target === native.id && owner.text === native.name &&
          instance.raw === `instance ${typeclass.text} ${native.name}` &&
          instance.markdown === `instance [${typeclass.text}](${typeclass.href}) :obj:\`${native.name} <${native.id}>\``,
        `instance head, links or owner differ for ${native.id}`)
        const href = sourceUrl(model, { ...native, source: instance.source } as ApiSymbol)!
        return `- ${instance.markdown} ([Source](${href}))${instance.doc ? `\n\n  ${instance.doc.replaceAll('\n', '\n  ')}` : ''}`
      })
      if (items.length) doc = { summary: doc?.summary ?? '',
        body: [doc?.body, '## Instances', items.join('\n\n')].filter(Boolean).join('\n\n') }
    }
    return {
      id: native.id, publicId: native.publicId ?? native.id, name: native.name,
      ...(native.qualifiedName ? { qualifiedName: native.qualifiedName } : {}),
      ...(native.namespace ? { namespace: native.namespace } : {}),
      ...(native.parent ? { parent: native.parent } : {}),
      kind: native.kind, modifiers: native.modifiers, signatures: native.signatures,
      package: native.package, product: 'core', apiScope: 'exported', source,
      ...(doc ? { doc } : {}), ...(references.length ? { references } : {}),
    }
  })
  exportGroupsNav(model)
  return model
}
