/**
 * Which strings of an extracted symbol the site renders as documentation prose, and what it builds from
 * the rest of a command.
 *
 * Every prose string reaches a reader through `ApiDoc` (one run of inline text) or `ApiProse` (blocks:
 * paragraphs and lists, with fences left alone), and `ApiDoc` links it with `SymbolIndex.docSpans`. The
 * link verifier collects destinations through the same function over the same strings, so it cannot read
 * a different set of fields than the page renders. Two lists keep that true as the model grows:
 *
 * - `PROSE_FIELDS` names every string field that holds documentation, and `STRUCTURAL_FIELDS` every
 *   other (a name, an address, a type, code, a revision). A symbol with a string in neither is reported
 *   by `unclassifiedFields`, and a test fails until someone decides which it is.
 * - `RENDERED_TEXTS` names every expression a component passes as `text` to `ApiDoc` or `ApiProse`, and
 *   what it stands for. A test reads the components and fails on an expression that is not listed.
 */

import { builtinHref } from './builtins.ts'
import { CONCEPTS } from './concepts.ts'
import type { ApiSymbol, Param } from './model.ts'

/** How a prose field is laid out: one run of inline text, paragraphs and lists, or either, by language. */
export type ProseForm = 'inline' | 'blocks' | 'both'

/** The string fields of a symbol that hold documentation: `.path` with array positions elided. */
export const PROSE_FIELDS: Record<string, ProseForm> = {
  '.doc.summary': 'inline',
  '.doc.body': 'blocks',
  '.doc.deprecated': 'blocks',
  '.doc.changed': 'blocks',
  '.doc.admonitions[].text': 'blocks',
  '.doc.examples[].intro': 'inline',
  '.doc.examples[].outro': 'inline',
  '.doc.references[].text': 'inline',
  '.signatures[].doc.summary': 'blocks',
  '.signatures[].doc.body': 'blocks',
  '.signatures[].params[].doc': 'both',
  '.signatures[].returnsDoc': 'inline',
  '.signatures[].raises[].doc': 'inline',
  '.signatures[].typeParameters[].doc': 'blocks',
  '.typeParameters[].doc': 'blocks',
}

/**
 * Every other string a symbol holds. `*` stands for any one key, so a new member of a family (an import,
 * a source field) is classified with the family. Fields extracted but not rendered by any component are
 * here too, with the reason.
 */
export const STRUCTURAL_FIELDS: string[] = [
  // Names, kinds and places.
  '.apiScope', '.exportedFrom', '.extends[]', '.id', '.inheritedFrom', '.kind', '.modifiers[]', '.name', '.namespace',
  '.namespaceImports[]', '.package', '.parent', '.product', '.publicId', '.publicOwner', '.qualifiedName', '.slug',
  '.value', '.variant', '.type', '.imports.*', '.source.*',
  // Types and signatures, which are linked as types.
  '.typeParamNames[]', '.typeParams[]',
  '.typeParameters[].bound', '.typeParameters[].default', '.typeParameters[].kind', '.typeParameters[].modifier', '.typeParameters[].name',
  '.signatures[].enclosingDeclaration', '.signatures[].enclosingTypeParamNames[]', '.signatures[].extension',
  '.signatures[].identity', '.signatures[].label', '.signatures[].methodKind', '.signatures[].raw', '.signatures[].returns',
  '.signatures[].source.*', '.signatures[].typeParamNames[]', '.signatures[].typeParams[]',
  '.signatures[].typeParameters[].bound', '.signatures[].typeParameters[].default', '.signatures[].typeParameters[].kind',
  '.signatures[].typeParameters[].modifier', '.signatures[].typeParameters[].name',
  '.signatures[].receiver.*', '.signatures[].raises[].type',
  '.signatures[].params[].name', '.signatures[].params[].type', '.signatures[].params[].default', '.signatures[].params[].variadic',
  '.signatures[].params[].since', '.signatures[].params[].deprecated',
  // A command's facts and a parameter's binding are written into prose by `commandFacts` and `parameterBindingText`.
  '.command.confirmImpact', '.command.defaultParameterSet', '.command.kind', '.command.outputTypes[]',
  '.command.inputTypes[].type', '.command.inputTypes[].description', '.command.relatedLinks[].*',
  '.signatures[].params[].binding.*',
  '.signatures[].params[].binding.attributes[].*', '.signatures[].params[].binding.attributes[].arguments[]',
  '.signatures[].params[].binding.attributes[].arguments[][]', '.signatures[].params[].binding.attributes[].namedArguments.*',
  '.signatures[].params[].binding.aliases[]', '.signatures[].params[].binding.declaration.*',
  '.signatures[].params[].binding.declaration.source.*',
  // Parts of the doc comment that are not prose: the kind of an admonition, a reference's name, example code.
  '.doc.admonitions[].kind', '.doc.references[].name', '.doc.since',
  '.doc.examples[].code', '.doc.examples[].lang', '.doc.examples[].sourceUrl',
  // Extracted, and rendered by no component.
  '.doc.seeAlso[]', '.declarations[].*', '.declarations[].doc.*', '.declarations[].source.*',
]

const STRUCTURAL = STRUCTURAL_FIELDS.map((pattern) => new RegExp(`^${pattern.replace(/[.[\]]/g, '\\$&').replace(/\*/g, '[^.[\\]]+')}$`))

/** Every string a value holds, with its `.path` (array positions elided). */
export function stringFields(value: unknown, path = ''): { path: string; text: string }[] {
  if (typeof value === 'string') return [{ path, text: value }]
  if (Array.isArray(value)) return value.flatMap((item) => stringFields(item, `${path}[]`))
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([key, item]) => stringFields(item, `${path}.${key}`))
  return []
}

/** The paths of a symbol's strings that are neither documentation nor structure. */
export function unclassifiedFields(symbol: ApiSymbol): string[] {
  return [...new Set(stringFields(symbol).map(({ path }) => path))]
    .filter((path) => !isProseField(path) && !isStructuralField(path))
    .sort()
}

/** Whether a field path is one of those the site renders as prose. */
export const isProseField = (path: string) => path in PROSE_FIELDS

/** Whether a field path is one of the strings that are not documentation. */
export const isStructuralField = (path: string) => STRUCTURAL.some((pattern) => pattern.test(path))

/**
 * Every expression a component passes as `text` to `ApiDoc` or `ApiProse`, and what it stands for: a
 * prose field of a symbol (by path), what `commandFacts` or `parameterBindingText` write, a note on an
 * alternative in another port, or the blocks `ApiProse` has already split.
 */
export const RENDERED_TEXTS: Record<string, string> = {
  'symbol.doc.summary': '.doc.summary',
  'owner.doc.summary': '.doc.summary',
  'o.doc.summary': '.doc.summary',
  'm.doc.summary': '.doc.summary',
  'member.doc.summary': '.doc.summary',
  'item.symbol.doc.summary': '.doc.summary',
  'symbol.doc.body': '.doc.body',
  'symbol.doc.deprecated': '.doc.deprecated',
  'symbol.doc.changed': '.doc.changed',
  'a.text': '.doc.admonitions[].text',
  'ex.intro': '.doc.examples[].intro',
  'ex.outro': '.doc.examples[].outro',
  'r.text': '.doc.references[].text',
  'signature.doc.summary': '.signatures[].doc.summary',
  'signature.doc.body': '.signatures[].doc.body',
  'p.doc': '.signatures[].params[].doc',
  'entry.doc': '.signatures[].returnsDoc',
  'r.doc': '.signatures[].raises[].doc',
  'fact.value': 'commandFacts and parameterBindingFacts',
  'parameterBindingText(p)!': 'parameterBindingText',
  'e.note': 'conceptNotes',
  'cell.note': 'conceptNotes',
  'block.text': 'ApiProse blocks',
  'item.text': 'ApiProse blocks',
  cell: 'ApiProse blocks',
}

export interface ProseText {
  /** The `.path` of the field, or what wrote the text. */
  field: string
  text: string
  form: ProseForm
  /** Written by the site from the model (a fact, a binding), not by an author: its links are the builtins it names. */
  derived?: true
}

/**
 * What a native command says about itself, as the labelled facts its reference shows. `kindHelp` is the
 * address of the glossary entry for the command's kind, which the page links when it has one.
 */
export function commandFacts(command: NonNullable<ApiSymbol['command']>, kindHelp?: string): { label: string; value: string }[] {
  const facts: { label: string; value: string }[] = [{ label: 'Command type', value: kindHelp ? `[\`${command.kind}\`](${kindHelp})` : `\`${command.kind}\`` }]
  if (command.defaultParameterSet && command.defaultParameterSet !== '__AllParameterSets') facts.push({ label: 'Default parameter set', value: command.defaultParameterSet })
  if (command.aliases.length) facts.push({ label: 'Aliases', value: command.aliases.map((alias) => `\`${alias}\``).join(', ') })
  if (command.supportsShouldProcess) facts.push({ label: 'Confirmation', value: `Supports \`-WhatIf\` and \`-Confirm\`; confirm impact: ${command.confirmImpact}.` })
  if (command.supportsPaging) facts.push({ label: 'Paging', value: 'Supports paging parameters.' })
  if (command.supportsTransactions) facts.push({ label: 'Transactions', value: 'Supports transactions.' })
  facts.push({ label: 'Positional binding', value: command.positionalBinding ? 'Enabled.' : 'Disabled; use named parameters unless a position is declared.' })
  if (command.inputTypes.length) facts.push({ label: 'Pipeline inputs', value: command.inputTypes.map((entry) => `\`${entry.type}\`${entry.description ? `: ${entry.description}` : ''}`).join('; ') })
  if (command.outputTypes.length) facts.push({ label: 'Outputs', value: command.outputTypes.map((type) => `\`${type}\``).join(', ') })
  return facts
}

/** Preserve the reflected attribute type even when its display name is short. */
function parameterAttributeText(attribute: NonNullable<Param['binding']>['attributes'][number]): string {
  const name = attribute.type.split('.').at(-1)!.replace(/Attribute$/, '')
  const call = `${name}(${attribute.arguments.map((value) => JSON.stringify(value)).join(', ')})`
  const fence = '`'.repeat(Math.max(1, ...[...call.matchAll(/`+/g)].map((match) => match[0].length + 1)))
  const label = `${fence}${call}${fence}`
  const href = builtinHref('powershell', attribute.type)
  return href ? `[${label}](${href})` : label
}

export function parameterBindingText(param: Param): string | undefined {
  const binding = param.binding
  if (!binding) return undefined
  const facts = [binding.mandatory ? 'Required.' : 'Optional.', binding.position === undefined ? 'Named parameter.' : `Position ${binding.position}.`]
  if (binding.switch) facts.push('Switch parameter.')
  if (binding.common) facts.push('Common parameter.')
  if (binding.dynamic) facts.push('Dynamic parameter.')
  const pipeline = [binding.pipeline.byValue && 'by value', binding.pipeline.byPropertyName && 'by property name'].filter(Boolean)
  facts.push(pipeline.length ? `Accepts pipeline input ${pipeline.join(' and ')}.` : 'Does not accept pipeline input.')
  if (binding.pipeline.remainingArguments) facts.push('Accepts remaining arguments.')
  if (binding.aliases.length) facts.push(`Aliases: ${binding.aliases.map((alias) => `\`${alias}\``).join(', ')}.`)
  if (binding.documentedDefault) facts.push(`Documented default: \`${binding.documentedDefault}\`.`)
  for (const attribute of binding.attributes.filter((entry) => /\.(Validate\w+|ArgumentCompleter)Attribute$/.test(entry.type))) {
    facts.push(`${parameterAttributeText(attribute)}.`)
  }
  return facts.join(' ')
}

/** Native properties are easier to compare as labelled facts than sentences. */
export function parameterBindingFacts(param: Param): { label: string; value: string }[] {
  const b = param.binding
  if (!b) return []
  const pipeline = [b.pipeline.byValue && 'By value', b.pipeline.byPropertyName && 'By property name'].filter(Boolean)
  const facts = [
    { label: 'Required', value: b.mandatory ? 'Yes' : 'No' },
    { label: 'Position', value: b.position === undefined ? 'Named' : String(b.position) },
    { label: 'Pipeline input', value: pipeline.join('; ') || 'No' },
  ]
  if (b.switch) facts.push({ label: 'Switch', value: 'Yes' })
  if (b.dynamic) facts.push({ label: 'Dynamic', value: 'Yes' })
  if (b.pipeline.remainingArguments) facts.push({ label: 'Remaining arguments', value: 'Yes' })
  if (b.aliases.length) facts.push({ label: 'Aliases', value: b.aliases.map((alias) => `\`${alias}\``).join(', ') })
  if (b.documentedDefault) facts.push({ label: 'Default', value: `\`${b.documentedDefault}\`` })
  for (const attribute of b.attributes.filter((entry) => /\.(Validate\w+|ArgumentCompleter)Attribute$/.test(entry.type))) {
    const name = attribute.type.split('.').at(-1)!.replace(/Attribute$/, '')
    facts.push({ label: name === 'ArgumentCompleter' ? 'Completion' : 'Validation', value: parameterAttributeText(attribute) })
  }
  return facts
}

/** Every string of a symbol the site renders as documentation, with how it is laid out. */
export function proseTexts(symbol: ApiSymbol): ProseText[] {
  const texts: ProseText[] = stringFields(symbol)
    .filter(({ path, text }) => isProseField(path) && text.trim() !== '')
    .map(({ path, text }) => ({ field: path, text, form: PROSE_FIELDS[path] }))
  if (symbol.command) for (const fact of commandFacts(symbol.command)) texts.push({ field: 'commandFacts', text: fact.value, form: 'inline', derived: true })
  for (const signature of symbol.signatures ?? []) {
    for (const param of signature.params ?? []) {
      const binding = parameterBindingText(param)
      if (binding) texts.push({ field: 'parameterBindingText', text: binding, form: 'inline', derived: true })
      for (const fact of parameterBindingFacts(param)) texts.push({ field: 'parameterBindingFacts', text: fact.value, form: 'inline', derived: true })
    }
  }
  return texts
}

/** The notes the alternatives in other ports carry, each read in the index of the port it is about. */
export function conceptNotes(): { port: string; text: string }[] {
  return Object.values(CONCEPTS).flatMap((concept) => Object.entries(concept.notes ?? {}).map(([port, text]) => ({ port, text })))
}
