import { createHash } from 'node:crypto'
import type { ApiModel, ApiSymbol } from '../model.ts'
import { parserFor } from '../parser.ts'
import { extractSourceWithSpec } from './spec.ts'
import { RUST } from './specs.ts'
import { rustWorkspaceLayout } from './rust-workspace.ts'

const families = ['Session', 'Window', 'Pane', 'Client']
const compact = (text: string) => text.replace(/\s+/g, '')
function requireContract(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Unsupported Rust snapshot projection: ${message}`)
}

/** Recover this source's four catalogue-generated snapshot owners and public field API. */
export async function attachNativeRustSnapshots(
  model: ApiModel,
  read: (file: string) => string | undefined,
  source: { repo: string; revision: string },
): Promise<ApiSymbol[]> {
  const core = rustWorkspaceLayout(read)?.find((entry) => entry.name === 'libtmux-core')
  if (!core) return []
  const file = `${core.root}/snapshot.rs`
  const raw = read(file)
  if (!raw || !families.some((family) => read(`${core.root}/lib.rs`)?.includes(`${family}Snapshot`))) return []
  requireContract(/\bdefine_snapshot_info\s*!/.test(raw), 'known snapshot producer')
  requireContract(model.port === 'rs' && source.repo === 'libtmux/libtmux-rs' && /^[a-f0-9]{40}$/.test(source.revision), 'exact Rust source identity')
  const paths = [file, `${core.root}/formats/catalog.rs`, `${core.root}/lib.rs`, core.inventory]
  const files = paths.map((path) => {
    const text = read(path)
    requireContract(typeof text === 'string' && text.trim(), `missing source: ${path}`)
    return { path, text, sha256: createHash('sha256').update(text).digest('hex') }
  })
  const parser = await parserFor('rust')
  const tree = (text: string, strict = true) => {
    const parsed = parser.parse(text)
    requireContract(parsed && (!strict || !parsed.rootNode.hasError), 'valid projected Rust syntax')
    return parsed.rootNode
  }
  const snapshots = tree(files[0].text, false)
  const catalogue = tree(files[1].text)
  const definition = (root: ReturnType<typeof tree>, name: string) => {
    const found = root.namedChildren.filter((node) => node?.type === 'macro_definition' && node.childForFieldName('name')?.text === name)
    requireContract(found.length === 1, `one local ${name} definition`)
    requireContract(!found[0]!.hasError, `valid local ${name} syntax`)
    const rules = found[0]!.namedChildren.filter((node) => node?.type === 'macro_rule')
    requireContract(rules.length === 1, `one ${name} rule`)
    return { node: found[0]!, matcher: rules[0]!.childForFieldName('left')!, body: rules[0]!.childForFieldName('right')! }
  }
  const producer = definition(snapshots, 'define_snapshot_info')
  const dispatch = definition(snapshots, 'define_snapshots')
  const catalog = definition(catalogue, 'format_catalog')
  requireContract(compact(catalog.matcher.text) === '($consumer:ident)' && compact(catalog.body.text).startsWith('{$consumer!{'), 'local catalogue callback')
  requireContract(compact(producer.body.text).includes('pubstruct$info{') &&
    compact(producer.body.text).includes('pubconstfn$baseline_field(&self)->&snapshot_type!($baseline_decoder)') &&
    compact(producer.body.text).includes('pubconstfn$field(&self)->borrowed_type!($decoder,$floor,$empty)') &&
    compact(producer.body.text).includes('pubstruct$fields<Target>{'), 'snapshot owner/getter/field-handle template')
  const get = /pub fn get<F: ReadField<Self>>\(&self, field: F\) -> Availability<F::Value<'_>>/.exec(producer.body.text)?.[0]
  requireContract(get, 'typed-field getter source signature')
  const calls = [...dispatch.body.text.matchAll(/define_snapshot_info!\(\s*(\w+),\s*(\w+),\s*(\w+),/g)]
  requireContract(calls.length === 4 && calls.every((call, index) => call[1] === `${families[index]}Snapshot` && call[2] === `${families[index]}Fields` && call[3] === families[index]), 'four fixed snapshot families')
  requireContract((files[0].text.match(/\bformat_catalog!\(\s*define_snapshots\s*\)/g) ?? []).length === 1, 'one catalogue invocation')
  const root = tree(files[2].text)
  const exports = root.namedChildren.filter((node) => node?.type === 'use_declaration' && /^pub\s+use\s+snapshot::\{/.test(node.text))
  const native = files[3].text.split('\n')
  const pending: ApiSymbol[] = []
  const declarations: Record<string, unknown>[] = []
  for (const family of families) {
    const owner = `${family}Snapshot`
    const fields = `${family}Fields`
    requireContract(exports.some((entry) => new RegExp(`\\b${owner}\\b`).test(entry!.text)), `root snapshot reexport: ${owner}`)
    const sections = [...catalog.body.text.matchAll(new RegExp(`\\b${family}Info\\s*\\{\\s*target:\\s*"([a-z]+)";\\s*baseline:\\s*(\\([^()]+\\));\\s*supplements:\\s*\\[([\\s\\S]*?)\\];\\s*\\}`, 'g'))]
    requireContract(sections.length === 1, `one ${family} catalogue section`)
    const section = sections[0]
    const rows = [...`${section[2]}${section[3]}`.matchAll(/\(\s*([A-Z_0-9]+),\s*([a-z_0-9]+),\s*"([a-z_0-9]+)",\s*(\w+),\s*(\w+),\s*(\w+),\s*(\w+),\s*(\w+),\s*(\w+)\)/g)]
    requireContract(rows.length > 0 && rows.every((row) => row[2] === row[3]), `literal ${family} field names`)
    const names = new Set(rows.map((row) => row[2]))
    requireContract(names.size === rows.length, `unique ${family} fields`)
    const path = `${core.namespace}::${owner}`
    requireContract(native.filter((line) => line === `struct ${path}`).length === 1, `one native snapshot owner: ${owner}`)
    const methods = native.flatMap((line) => {
      const match = new RegExp(`^function ${path}::(\\w+): (.+)$`).exec(line)
      return match ? [{ name: match[1], signature: match[2] }] : []
    })
    requireContract(methods.length === names.size + 1 && methods.every((method) => method.name === 'get' || names.has(method.name)), `native getters agree with ${family} catalogue`)
    for (const name of names) requireContract(methods.filter((method) => method.name === name && method.signature.startsWith('const fn(')).length === 1, `one const native getter: ${name}`)
    const methodSource = methods.map((method) => `/// ${method.name === 'get' ? 'Read a typed field from this observation.' : `Return the decoded \`${method.name}\` value.`}\n${method.name === 'get' ? `#[cfg(feature = "query")]\n${get}` : `pub ${method.signature.replace(/\bfn(?=[<(])/, `fn ${method.name}`)}`} { loop {} }`).join('\n')
    let declaration = `/// The values from one tmux ${section[1]} listing row.\npub struct ${owner};\nimpl ${owner} {\n${methodSource}\n}`
    const fieldPath = `${core.namespace}::${fields}`
    const handles = native.flatMap((line) => {
      const match = new RegExp(`^struct_field ${fieldPath}::(\\w+): (.+)$`).exec(line)
      return match ? [{ name: match[1], type: match[2] }] : []
    })
    requireContract(native.filter((line) => line === `struct ${fieldPath}<Target>`).length === 1 && handles.length === names.size && handles.every((handle) => names.has(handle.name)), `native filter handles agree with ${family} catalogue`)
    const constructor = native.flatMap((line) => line.startsWith(`function ${fieldPath}::for_target: `) ? [line.split(': ').slice(1).join(': ')] : [])
    requireContract(constructor.length === 1, `one native filter-handle constructor: ${fields}`)
    declaration += `\n/// Typed filter field handles for a \`${section[1]}\`.\n#[cfg(feature = "query")]\npub struct ${fields}<Target> {\n${handles.map((handle) => `/// The \`${handle.name}\` field.\npub ${handle.name}: ${handle.type},`).join('\n')}\n}\nimpl<Target> ${fields}<Target> { pub ${constructor[0].replace(/\bfn(?=[<(])/, 'fn for_target')} { loop {} } }`
    requireContract(!tree(declaration).hasError, 'valid projected declaration signatures')
    const extracted = await extractSourceWithSpec(RUST, declaration, file, `${core.namespace}.snapshot`)
    const call = calls.find((entry) => entry[1] === owner)!
    const line = files[0].text.slice(0, dispatch.body.startIndex + call.index!).split('\n').length
    for (const symbol of extracted.filter((entry) => entry.kind !== 'class')) {
      const normalize = (value: string) => value.replaceAll(`${fields}<Target>`, fields)
      symbol.id = normalize(symbol.id)
      symbol.qualifiedName = symbol.id
      if (symbol.parent) symbol.parent = normalize(symbol.parent)
      symbol.namespace = core.namespace
      symbol.publicId = symbol.id.replace(`${core.namespace}.snapshot.`, `${core.namespace}.`)
      symbol.source = { ...symbol.source, ...source, line, extractedRevision: source.revision }
      for (const signature of symbol.signatures) signature.source = { file, line }
      requireContract(![...model.symbols, ...pending].some((entry) => entry.id === symbol.id), `duplicate projected declaration: ${symbol.id}`)
      pending.push(symbol)
    }
    requireContract(pending.some((entry) => entry.publicId === `${core.namespace}.${owner}`) && pending.filter((entry) => entry.parent === `${core.namespace}.snapshot.${owner}`).length === methods.length, `all native snapshot members recovered: ${owner}`)
    declarations.push({ owner, fields, line, catalogueFields: [...names], nativeMethods: methods, declaration })
  }
  const provenance = model.nativeProvenance ?? { files: [], exporter: {} }
  requireContract(!provenance.exporter.rustSnapshots, 'projection not already attached')
  for (const file of files) requireContract(!provenance.files.some((entry) => entry.path === file.path && entry.sha256 !== file.sha256), `source hash agrees: ${file.path}`)
  model.symbols.push(...pending)
  model.nativeProvenance = { files: [...provenance.files, ...files.filter((file) => !provenance.files.some((entry) => entry.path === file.path)).map(({ path, sha256 }) => ({ path, sha256 }))],
    exporter: { ...provenance.exporter, rustSnapshots: { schemaVersion: 1, source,
      scope: 'snapshot-owners-getters-filter-handles', definitionLine: producer.node.startPosition.row + 1, declarations } } }
  return pending
}
