import { createHash } from 'node:crypto'
import type { Node } from 'web-tree-sitter'
import type { ApiModel, ApiSymbol } from '../model.ts'
import { parserFor } from '../parser.ts'
import { extractSourceWithSpec } from './spec.ts'
import { RUST } from './specs.ts'

const targetFile = 'crates/libtmux/src/target.rs'
const rootFile = 'crates/libtmux/src/lib.rs'
const inventoryFile = 'crates/libtmux/docs/public-api.txt'
const macroName = 'define_id'
const comment = (node: Node) => RUST.commentTypes.includes(node.type)
const docComment = (node: Node) => node.type === 'line_comment' && /^\/\/\/(?!\/)/.test(node.text)
const compact = (text: string) => text.replace(/\s+/g, '')

function requireContract(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Unsupported Rust ${macroName} contract: ${message}`)
}

/** Outer attributes can change expansion or visibility; this projection does not evaluate cfg. */
function noAttributes(node: Node): void {
  for (let previous = node.previousNamedSibling; previous; previous = previous.previousNamedSibling) {
    if (comment(previous)) continue
    requireContract(previous.type !== 'attribute_item', `attributes on ${node.type} at line ${node.startPosition.row + 1}`)
    break
  }
}

/**
 * Recover the native ID owners from this repository's local macro family.
 * This transcribes its one supported rule, not arbitrary Rust macros. Only
 * struct owners are extracted; generated trait implementations stay outside
 * this projection, as do the separate target-enum macros.
 */
export async function attachNativeRustIdStructs(
  model: ApiModel,
  read: (path: string) => string | undefined,
  source: { repo: string; revision: string },
): Promise<ApiSymbol[]> {
  requireContract(model.port === 'rs' && source.repo === 'libtmux/libtmux-rs' && /^[a-f0-9]{40}$/.test(source.revision),
    'source must name the Rust repository and a full revision')
  const files = [targetFile, rootFile, inventoryFile].map((path) => {
    const text = read(path)
    requireContract(typeof text === 'string' && text.trim(), `missing source: ${path}`)
    return { path, text, sha256: createHash('sha256').update(text).digest('hex') }
  })
  const parser = await parserFor('rust')
  const parse = (text: string, label: string) => {
    const tree = parser.parse(text)
    requireContract(tree && !tree.rootNode.hasError, `invalid syntax in ${label}`)
    return tree.rootNode
  }
  const target = parse(files[0].text, targetFile)
  const root = parse(files[1].text, rootFile)
  for (const tree of [target, root]) {
    // This grammar calls an inner attribute on the first line a shebang.
    for (const attr of tree.namedChildren.filter((node) => node?.type === 'inner_attribute_item' ||
      (node?.type === 'shebang' && /^#!\s*\[/.test(node.text)))) {
      requireContract(attr && !/\bcfg\s*\(|\bdoc\s*\(\s*hidden\b/.test(attr.text),
        'conditional or hidden source module')
    }
  }
  const definitions = target.descendantsOfType('macro_definition')
    .filter((node) => node?.childForFieldName('name')?.text === macroName)
  requireContract(definitions.length === 1 && definitions[0]?.parent?.id === target.id,
    'expected one top-level local definition')
  const definition = definitions[0]!
  noAttributes(definition)
  const rules = definition.namedChildren.filter((node) => node?.type === 'macro_rule')
  const matcher = rules[0]?.childForFieldName('left')
  const body = rules[0]?.childForFieldName('right')
  requireContract(rules.length === 1 && matcher && body &&
    compact(matcher.text) === '($(#[$attribute:meta])*$name:ident,$sigil:literal)',
  'expected the single attributes/name/sigil rule')
  const repetitions = body.descendantsOfType('token_repetition')
  requireContract(repetitions.length === 1 && compact(repetitions[0]!.text) === '$(#[$attribute])*',
    'expected one forwarded attribute repetition')
  const repeated = repetitions[0]!
  const variables = body.descendantsOfType('metavariable')
    .filter((node) => node && !(node.startIndex >= repeated.startIndex && node.endIndex <= repeated.endIndex)) as Node[]
  requireContract(variables.every((node) => ['$name', '$sigil'].includes(node.text)), 'unsupported transcriber variable')
  const calls = target.descendantsOfType('macro_invocation')
    .filter((node) => node?.childForFieldName('macro')?.text === macroName) as Node[]
  requireContract(calls.length, 'no local invocations')
  const module = root.namedChildren.filter((node) => node?.type === 'mod_item' && node.childForFieldName('name')?.text === 'target')
  requireContract(module.length === 1 && !module[0]!.childForFieldName('body'), 'expected the target source module')
  noAttributes(module[0]!)

  const pending: ApiModel['symbols'] = []
  const declarations: { id: string; native: string; invocationLine: number; nameLine: number; declaration: string }[] = []
  for (const call of calls) {
    const statement = call.parent?.type === 'expression_statement' ? call.parent : call
    requireContract(statement.parent?.id === target.id && call.startIndex > definition.endIndex,
      'invocations must follow the local definition at module scope')
    noAttributes(statement)
    const tokens = call.namedChildren.find((node) => node?.type === 'token_tree')
    requireContract(tokens, 'missing invocation arguments')
    const args = tokens.namedChildren.filter((node) => node && !comment(node)) as Node[]
    const name = args.at(-2)
    const sigil = args.at(-1)
    requireContract(name?.type === 'identifier' && /^[A-Za-z_]\w*$/.test(name.text) && sigil?.type === 'char_literal',
      'expected an identifier and character sigil')
    const tail = tokens.children.filter((node) => node && node.startIndex >= name.startIndex &&
      node.endIndex < tokens.endIndex && !comment(node)).map((node) => node!.text)
    requireContract(JSON.stringify(tail) === JSON.stringify([name.text, ',', sigil.text]),
      'unexpected invocation arguments')
    const prefix = files[0].text.slice(tokens.startIndex + 1, name.startIndex).trim()
    const prefixTree = parse(`${prefix}\npub struct ${name.text};`, 'invocation attributes')
    requireContract(prefixTree.namedChildren.every((node) => node &&
      (comment(node) || node.type === 'struct_item')), 'only source doc comments are supported as invocation attributes')
    const edits = [{ node: repeated, text: prefix }, ...variables.map((node) => ({
      node, text: node.text === '$name' ? name.text : sigil.text,
    }))].sort((a, b) => b.node.startIndex - a.node.startIndex)
    let expansion = files[0].text.slice(body.startIndex + 1, body.endIndex - 1)
    for (const edit of edits) {
      const start = edit.node.startIndex - body.startIndex - 1
      const end = edit.node.endIndex - body.startIndex - 1
      expansion = expansion.slice(0, start) + edit.text + expansion.slice(end)
    }
    const expanded = parse(expansion, `expansion for ${name.text}`)
    const items = expanded.namedChildren.filter((node) => node && !comment(node) && node.type !== 'attribute_item') as Node[]
    const owner = items[0]
    requireContract(owner?.type === 'struct_item' && owner.childForFieldName('name')?.text === name.text &&
      owner.namedChildren.some((node) => node?.type === 'visibility_modifier' && node.text === 'pub') &&
      !owner.childForFieldName('type_parameters') && items.slice(1).every((node) => node.type === 'impl_item'),
    'expected one public non-generic struct followed only by impl blocks')
    const prefixNodes = expanded.namedChildren.filter((node) => node && node.endIndex <= owner.startIndex) as Node[]
    requireContract(!prefixNodes.some((node) => /^\/\*\*|^\/\/!|^\/\*!/.test(node.text)),
      'only outer line doc comments are supported')
    const derives = new Set(['Clone', 'Copy', 'Debug', 'Default', 'Eq', 'Hash', 'Ord', 'PartialEq', 'PartialOrd'])
    for (const attr of prefixNodes.filter((node) => node.type === 'attribute_item')) {
      const match = /^#\[derive\(([^)]+)\)\]$/.exec(compact(attr.text))
      requireContract(match && match[1].split(',').every((trait) => derives.has(trait)),
        `unsupported struct attribute: ${attr.text}`)
    }
    // Rust doc comments are attributes even across whitespace and ordinary comments.
    const declaration = [...prefixNodes.filter((node) => !comment(node) || docComment(node))
      .map((node) => node.text), owner.text].join('\n')
    const extracted = await extractSourceWithSpec(RUST, declaration, targetFile, 'target')
    requireContract(extracted.length === 1 && extracted[0].kind === 'struct', 'public fields are outside the owner-only projection')
    const symbol = extracted[0]
    requireContract(![...model.symbols, ...pending].some((entry) => entry.id === symbol.id || entry.publicId === symbol.id),
      `declaration already exists: ${symbol.id}`)
    const native = `libtmux::${name.text}`
    requireContract(files[2].text.split('\n').filter((line) => line === `struct ${native}`).length === 1 &&
      files[2].text.split('\n').filter((line) => /^\w+ /.test(line) && line.split(' ')[1] === native).length === 1,
    `native inventory must name one public struct: ${native}`)
    const exports = root.namedChildren.filter((node) => {
      if (node?.type !== 'use_declaration' || !node.namedChildren.some((child) => child?.type === 'visibility_modifier' && child.text === 'pub')) return false
      const argument = node.childForFieldName('argument')
      return argument?.type === 'scoped_use_list' && argument.childForFieldName('path')?.text === 'target' &&
        argument.childForFieldName('list')?.namedChildren.some((child) => child?.type === 'identifier' && child.text === name.text)
    })
    requireContract(exports.length === 1, `expected one unaliased root reexport: ${name.text}`)
    noAttributes(exports[0]!)
    symbol.publicId = symbol.id
    symbol.source = { ...symbol.source, ...source, line: name.startPosition.row + 1, extractedRevision: source.revision }
    pending.push(symbol)
    declarations.push({ id: symbol.id, native, invocationLine: call.startPosition.row + 1,
      nameLine: name.startPosition.row + 1, declaration })
  }
  const provenance = model.nativeProvenance ?? { files: [], exporter: {} }
  requireContract(!provenance.exporter.rustIdStructs, 'projection already attached')
  for (const file of files) {
    const prior = provenance.files.find((entry) => entry.path === file.path)
    requireContract(!prior || prior.sha256 === file.sha256, `conflicting source hash: ${file.path}`)
  }
  model.symbols.push(...pending)
  model.nativeProvenance = {
    files: [...provenance.files, ...files.filter((file) => !provenance.files.some((entry) => entry.path === file.path))
      .map(({ path, sha256 }) => ({ path, sha256 }))],
    exporter: { ...provenance.exporter, rustIdStructs: {
      schemaVersion: 1, source, macro: macroName, definitionLine: definition.startPosition.row + 1,
      scope: 'struct-owners', declarations,
    } },
  }
  return pending
}
