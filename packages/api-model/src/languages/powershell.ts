import { posix } from 'node:path'
import type { ApiModel, ApiProduct, ApiSymbol, Param, Signature } from '../model.ts'

interface Source {
  file: string
  line: number
  endLine?: number
}
interface NativeParameter {
  name: string
  type: string
  mandatory: boolean
  position: number | null
  switch: boolean
  common: boolean
  dynamic: boolean
  aliases: string[]
  pipeline: NonNullable<Param['binding']>['pipeline']
  description: string
  documentedDefault: string | null
  declaration: { source: Source; declaration: string; default: string | null } | null
  attributes: NonNullable<Param['binding']>['attributes']
}
interface ParameterSet {
  name: string
  isDefault: boolean
  parameters: NativeParameter[]
}
interface NativeCommand extends Omit<NonNullable<ApiSymbol['command']>, 'defaultParameterSet'> {
  defaultParameterSet: string | null
  id: string
  name: string
  module: string
  product: ApiProduct
  source: Source
  synopsis: string
  description: string
  notes: string
  help: { file: string; markdown: string }
  parameterSets: ParameterSet[]
  examples: { title: string; introduction: string; code: string; remarks: string }[]
  documentedOutputs: { type: string; description: string }[]
}
interface NativeModule {
  name: string
  version: string
  product: ApiProduct
  description: string
  source: Source
  commands: string[]
}
interface PowerShellArtifact {
  schema: number
  port: string
  source: { repository: string; revision: string; files: { path: string; sha256: string }[] }
  exporter: Record<string, unknown> & { name: string; version: number }
  modules: NativeModule[]
  commands: NativeCommand[]
}

function assertArtifact(input: unknown, revision?: string): PowerShellArtifact {
  const artifact = input as PowerShellArtifact
  if (
    artifact?.schema !== 1 ||
    artifact.port !== 'powershell' ||
    !Array.isArray(artifact.modules) ||
    !Array.isArray(artifact.commands) ||
    !/^[a-f0-9]{40}$/.test(artifact.source?.revision ?? '')
  ) {
    throw new Error('PowerShell documentation artifact has an unsupported schema or source identity')
  }
  if (revision && artifact.source.revision !== revision)
    throw new Error('PowerShell artifact source revision differs from the selected checkout')
  const ids = new Set<string>()
  const modules = new Map(artifact.modules.map((entry) => [entry.name, entry]))
  for (const command of artifact.commands) {
    if (ids.has(command.id) || command.id !== `${command.module}\\${command.name}` || !modules.has(command.module)) {
      throw new Error(`PowerShell command has a duplicate or unknown identity: ${command.id}`)
    }
    ids.add(command.id)
    if (
      !command.parameterSets.length ||
      new Set(command.parameterSets.map((set) => set.name)).size !== command.parameterSets.length
    ) {
      throw new Error(`PowerShell command lost distinct parameter sets: ${command.id}`)
    }
    for (const set of command.parameterSets) {
      if (new Set(set.parameters.map((parameter) => parameter.name)).size !== set.parameters.length) {
        throw new Error(`PowerShell parameter set repeats a parameter: ${command.id}/${set.name}`)
      }
      for (const parameter of set.parameters) {
        if (
          !parameter.type ||
          typeof parameter.pipeline?.byValue !== 'boolean' ||
          typeof parameter.pipeline?.byPropertyName !== 'boolean'
        ) {
          throw new Error(
            `PowerShell parameter lost native binding metadata: ${command.id}/${set.name}/${parameter.name}`,
          )
        }
      }
    }
    if (command.examples.some((example) => !example.code.trim()))
      throw new Error(`PowerShell command lost example code: ${command.id}`)
  }
  for (const entry of artifact.modules) {
    const declared = [...entry.commands].sort()
    const actual = artifact.commands
      .filter((command) => command.module === entry.name)
      .map((command) => command.name)
      .sort()
    if (JSON.stringify(declared) !== JSON.stringify(actual))
      throw new Error(`PowerShell module inventory differs: ${entry.name}`)
  }
  return artifact
}

function splitTypes(value: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let index = 0; index < value.length; index++) {
    if (value[index] === '[') depth++
    else if (value[index] === ']') depth--
    else if (value[index] === ',' && depth === 0) {
      parts.push(value.slice(start, index))
      start = index + 1
    }
  }
  parts.push(value.slice(start))
  return parts
}

/** Render reflected closed generic types without their assembly loader metadata. */
export function powerShellType(value: string): string {
  if (value.startsWith('[') && value.endsWith(']')) value = value.slice(1, -1)
  value = splitTypes(value)[0]!.trim()
  const open = value.indexOf('[')
  if (!value.includes('`') || open < 0) return value.replaceAll('+', '.')
  const name = value.slice(0, open).replace(/`\d+/g, '').replaceAll('+', '.')
  const suffix = value.endsWith('[]') ? '[]' : ''
  const close = value.length - suffix.length - 1
  const arguments_ = splitTypes(value.slice(open + 1, close)).map(powerShellType)
  return `${name}[${arguments_.join(', ')}]${suffix}`
}

// PowerShell supplies these parameters, so command help can omit their descriptions.
// https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_commonparameters?view=powershell-7.4
const commonParameterDescriptions: Readonly<Record<string, string>> = {
  Verbose: 'Display verbose messages produced by this command.',
  Debug: 'Display debug messages produced by this command.',
  ErrorAction: 'Choose how this command responds to non-terminating errors.',
  WarningAction: 'Choose how this command responds to warning messages.',
  InformationAction: 'Choose how this command handles information messages.',
  ProgressAction: 'Choose how this command handles progress updates.',
  ErrorVariable: "Store the command's error records in the named variable.",
  WarningVariable: "Store the command's warning records in the named variable.",
  InformationVariable: "Store the command's information records in the named variable.",
  OutVariable: 'Save output in the named variable while passing it down the pipeline.',
  OutBuffer: 'Buffer output before passing it to the next pipeline command.',
  PipelineVariable: 'Make the most recent output object available through a named variable within the pipeline.',
}

function parameter(entry: NativeParameter, source: (location: Source) => ApiSymbol['source']): Param {
  return {
    name: entry.name,
    type: powerShellType(entry.type),
    doc: entry.description.trim()
      ? entry.description
      : entry.common
        ? commonParameterDescriptions[entry.name]
        : undefined,
    default: entry.documentedDefault && entry.documentedDefault !== 'None' ? entry.documentedDefault : undefined,
    keywordOnly: entry.position === null,
    binding: {
      mandatory: entry.mandatory,
      position: entry.position ?? undefined,
      switch: entry.switch,
      common: entry.common,
      dynamic: entry.dynamic,
      aliases: entry.aliases,
      pipeline: entry.pipeline,
      documentedDefault: entry.documentedDefault ?? undefined,
      nativeType: entry.type,
      attributes: entry.attributes,
      declaration: entry.declaration
        ? {
            text: entry.declaration.declaration,
            initializer: entry.declaration.default ?? undefined,
            source: source(entry.declaration.source),
          }
        : undefined,
    },
  }
}

function syntax(command: NativeCommand, set: ParameterSet): string {
  const parameters = set.parameters
    .filter((entry) => !entry.common)
    .map((entry) => {
      const name = entry.position === null ? `-${entry.name}` : `[-${entry.name}]`
      const value = entry.switch ? name : `${name} <${powerShellType(entry.type)}>`
      return entry.mandatory ? value : `[${value}]`
    })
  if (set.parameters.some((entry) => entry.common)) parameters.push('[<CommonParameters>]')
  return `${command.name} ${parameters.join(' ')}`
}

/** Normalize the complete native module inventory without exposing cmdlet implementation classes. */
export function extractPowerShell(input: unknown, expectedRevision?: string): ApiModel {
  const artifact = assertArtifact(input, expectedRevision)
  const source = (location: Source): ApiSymbol['source'] => ({
    file: location.file,
    line: location.line,
    repo: artifact.source.repository,
    revision: artifact.source.revision,
    extractedRevision: artifact.source.revision,
  })
  const symbols: ApiSymbol[] = artifact.modules.map((entry) => ({
    id: entry.name,
    publicId: entry.name,
    name: entry.name,
    kind: 'module',
    modifiers: [],
    signatures: [],
    product: entry.product,
    package: entry.name,
    apiScope: 'exported',
    source: source(entry.source),
    doc: { summary: entry.description },
  }))
  for (const entry of artifact.commands) {
    const href = (target: string) =>
      /^(?:https?:|#)/.test(target)
        ? target
        : `https://github.com/${artifact.source.repository}/blob/${artifact.source.revision}/${posix.normalize(posix.join(posix.dirname(entry.help.file), target))}`
    const prose = (text: string) =>
      text.replace(
        /\[([^\]\n]+)\]\(([^\s)]+)\)/g,
        (_match, label: string, target: string) => `[${label}](${href(target)})`,
      )
    const signatures: Signature[] = entry.parameterSets.map((set) => ({
      identity: `${entry.id}/${set.name}`,
      label: set.name,
      isDefault: set.isDefault,
      raw: syntax(entry, set),
      params: set.parameters.map((item) => parameter({ ...item, description: prose(item.description) }, source)),
      returns: entry.outputTypes.map(powerShellType).join(' | ') || undefined,
      returnsDoc:
        entry.documentedOutputs
          .map((item) => `\`${powerShellType(item.type)}\`${item.description ? `: ${item.description}` : ''}`)
          .join('\n\n') || undefined,
      source: source(entry.source),
    }))
    symbols.push({
      id: entry.id,
      publicId: entry.id,
      name: entry.name,
      kind: 'function',
      modifiers: [],
      parent: entry.module,
      namespace: entry.module,
      signatures,
      product: entry.product,
      package: entry.module,
      apiScope: 'exported',
      source: source(entry.source),
      doc: {
        summary: prose(entry.synopsis),
        body: prose([entry.description, entry.notes ? `### Notes\n\n${entry.notes}` : ''].filter(Boolean).join('\n\n')),
        examples: entry.examples.map((example) => ({
          lang: 'powershell',
          code: example.code,
          intro: prose([example.title, example.introduction].filter(Boolean).join('\n\n')),
          outro: prose(example.remarks) || undefined,
          sourceUrl: `https://github.com/${artifact.source.repository}/blob/${artifact.source.revision}/${entry.help.file}`,
        })),
      },
      command: {
        kind: entry.kind,
        aliases: entry.aliases,
        defaultParameterSet: entry.defaultParameterSet ?? undefined,
        supportsShouldProcess: entry.supportsShouldProcess,
        supportsPaging: entry.supportsPaging,
        supportsTransactions: entry.supportsTransactions,
        confirmImpact: entry.confirmImpact,
        positionalBinding: entry.positionalBinding,
        inputTypes: entry.inputTypes.map((item) => ({ ...item, type: powerShellType(item.type) })),
        outputTypes: entry.outputTypes.map(powerShellType),
        relatedLinks: entry.relatedLinks.map((link) => ({ ...link, href: link.href ? href(link.href) : '' })),
      },
    })
  }
  return {
    port: 'powershell',
    repo: artifact.source.repository,
    revision: artifact.source.revision,
    extractor: `@libtmux/api-model@0.0.1 (${artifact.exporter.name} v${artifact.exporter.version})`,
    nativeProvenance: { files: artifact.source.files, exporter: artifact.exporter },
    sources: artifact.modules.map((entry) => ({
      product: entry.product,
      package: entry.name,
      version: entry.version,
      repo: artifact.source.repository,
      revision: artifact.source.revision,
      extractedRevision: artifact.source.revision,
    })),
    symbols,
  }
}
