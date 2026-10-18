/** JSON Schema pointers keep nested fields and definitions independently linkable. */
export type McpSchema = boolean | { [key: string]: unknown; type?: string | string[]; description?: string;
  properties?: Record<string, McpSchema>; required?: string[]; items?: McpSchema;
  $ref?: string; $defs?: Record<string, McpSchema>; definitions?: Record<string, McpSchema>;
  anyOf?: McpSchema[]; oneOf?: McpSchema[]; allOf?: McpSchema[] }

export const pointerPart = (name: string) => name.replaceAll('~', '~0').replaceAll('/', '~1')
export const schemaAnchor = (scope: string, pointer: string) => `${scope}${pointer}`

const SCHEMA_TYPES: Record<string, string> = {
  object: 'object', array: 'array', string: 'string', integer: 'numeric',
  number: 'numeric', boolean: 'boolean', null: 'null',
}
export interface SchemaTypePart { text: string; href?: string }

/** Link each type token, including references nested inside containers and unions. */
export function schemaTypeParts(schema: McpSchema, root: McpSchema, scope: string): SchemaTypePart[] {
  const literal = (text: string): SchemaTypePart[] => [{ text }]
  const primitive = (name: string): SchemaTypePart => ({ text: name,
    ...(SCHEMA_TYPES[name] ? { href: `https://json-schema.org/understanding-json-schema/reference/${SCHEMA_TYPES[name]}` } : {}) })
  const join = (parts: SchemaTypePart[][], separator: string) => parts.flatMap((part, i) => i ? [{ text: separator }, ...part] : part)
  if (typeof schema === 'boolean') return literal(schemaType(schema))
  if (schema.$ref) return [{ text: schemaType(schema), href: schemaReference(root, schema.$ref, scope) }]
  if (Object.hasOwn(schema, 'const') || Array.isArray(schema.enum)) return literal(schemaType(schema))
  const alternatives = schema.anyOf ?? schema.oneOf ?? schema.allOf
  if (alternatives) return join(alternatives.map((part) => schemaTypeParts(part, root, scope)), schema.allOf ? ' & ' : ' | ')
  const named = (name: string): SchemaTypePart[] => name === 'array'
    ? [{ ...primitive('array'), text: 'Array' }, { text: '<' }, ...schemaTypeParts(schema.items ?? true, root, scope), { text: '>' }]
    : name === 'object' && isMap(schema)
      ? [{ ...primitive('object'), text: 'Record' }, { text: '<string, ' }, ...schemaTypeParts(schema.additionalProperties as McpSchema, root, scope), { text: '>' }]
      : [primitive(name)]
  return Array.isArray(schema.type) ? join(schema.type.map(named), ' | ') : named(schema.type ?? schemaType(schema))
}

/** An object whose only shape is the type of its values. */
const isMap = (schema: McpSchema): boolean => typeof schema === 'object' && !schema.properties &&
  typeof schema.additionalProperties === 'object' && schema.additionalProperties !== null

export const isSchemaDefinition = (path: string) => /^\/(?:\$defs|definitions)\//.test(path)

/** Named definitions have their own section while retaining original pointer identities. */
export function schemaDefinitions(schema: McpSchema, pointer = ''): { name: string; path: string; schema: McpSchema }[] {
  return schemaChildren(schema).flatMap((child) => [
    ...(isSchemaDefinition(child.path) ? [{ ...child, path: pointer + child.path }] : []),
    ...schemaDefinitions(child.schema, pointer + child.path),
  ])
}

/**
 * A schema its parent's type line already documents in full: an array item,
 * a union member or a map's value type with no prose, constraints or fields
 * of its own.
 */
export function inlineSchemaItem(schema: McpSchema): boolean {
  if (typeof schema === 'boolean') return true
  return !schema.description && !schemaConstraints(schema).length && schemaRows(schema).rows.length === 0
}

export interface SchemaRow { name: string; label: string; path: string; schema: McpSchema; required?: boolean }

const rowLabel = (name: string, path: string): string => {
  const part = /^\/(anyOf|oneOf|allOf)\/(\d+)$/.exec(path)
  return part ? `${part[1] === 'allOf' ? 'Part' : 'Variant'} ${Number(part[2]) + 1}` : name
}

/**
 * The fields a schema lists beneath its heading, and the pointers it folds into its type line.
 *
 * Properties always list. A union member, array item or map value lists only
 * when it says more than its type; the folded pointers stay addressable so
 * links to them land on the field that now holds them.
 */
export function schemaRows(schema: McpSchema): { rows: SchemaRow[]; aliases: string[] } {
  const rows: SchemaRow[] = []
  const aliases: string[] = []
  const descendants = (child: McpSchema, prefix: string): string[] => schemaChildren(child)
    .filter((entry) => !isSchemaDefinition(entry.path)).flatMap((entry) => [prefix + entry.path, ...descendants(entry.schema, prefix + entry.path)])
  for (const child of schemaChildren(schema)) {
    if (isSchemaDefinition(child.path)) continue
    if (!child.path.startsWith('/properties/') && inlineSchemaItem(child.schema)) {
      aliases.push(child.path, ...descendants(child.schema, child.path))
    } else rows.push({ ...child, label: rowLabel(child.name, child.path) })
  }
  return { rows, aliases }
}

/** A field's declared default, as the JSON it was written in. */
export const schemaDefault = (schema: McpSchema): string | undefined =>
  typeof schema === 'object' && Object.hasOwn(schema, 'default') ? JSON.stringify(schema.default) : undefined

export function schemaType(schema: McpSchema): string {
  if (typeof schema === 'boolean') return schema ? 'any value' : 'no value'
  if (schema.$ref) return schema.$ref.split('/').at(-1)!.replaceAll('~1', '/').replaceAll('~0', '~')
  if (Object.hasOwn(schema, 'const')) return JSON.stringify(schema.const)
  if (Array.isArray(schema.enum)) return schema.enum.map((value) => JSON.stringify(value)).join(' | ')
  const alternatives = schema.anyOf ?? schema.oneOf ?? schema.allOf
  if (alternatives) return alternatives.map(schemaType).join(schema.allOf ? ' & ' : ' | ')
  const named = (name: string) => name === 'array' ? `Array<${schema.items === undefined ? 'any value' : schemaType(schema.items)}>`
    : name === 'object' && isMap(schema) ? `Record<string, ${schemaType(schema.additionalProperties as McpSchema)}>` : name
  return Array.isArray(schema.type) ? schema.type.map(named).join(' | ') : named(schema.type ?? (schema.properties ? 'object' : 'any value'))
}

/** A reference links only when its JSON pointer resolves inside this schema. */
export function schemaReference(root: McpSchema, ref: string, scope: string): string | undefined {
  if (!ref.startsWith('#/')) return undefined
  let target: unknown = root
  let pointer: string
  try { pointer = decodeURIComponent(ref.slice(1)) } catch { return undefined }
  for (const part of pointer.slice(1).split('/')) {
    const key = part.replaceAll('~1', '/').replaceAll('~0', '~')
    if (!target || typeof target !== 'object' || !Object.hasOwn(target, key)) return undefined
    target = (target as Record<string, unknown>)[key]
  }
  const rendered = (schema: McpSchema, prefix = ''): boolean => schemaChildren(schema).some((child) =>
    prefix + child.path === pointer || rendered(child.schema, prefix + child.path))
  if (!rendered(root)) return undefined
  return `#${encodeURIComponent(schemaAnchor(scope, pointer))}`
}

const CONSTRAINTS = ['default', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
  'minLength', 'maxLength', 'pattern', 'format', 'minItems', 'maxItems', 'uniqueItems', 'minProperties', 'maxProperties',
  'additionalProperties', 'readOnly', 'writeOnly', 'deprecated', 'contentEncoding', 'contentMediaType', 'x-maxUtf8Bytes']
export function schemaConstraints(schema: McpSchema): [string, string][] {
  if (typeof schema === 'boolean') return []
  return CONSTRAINTS.filter((key) => Object.hasOwn(schema, key) && (typeof schema[key] !== 'object' || schema[key] === null))
    .map((key) => [key, JSON.stringify(schema[key])])
}

export function schemaChildren(schema: McpSchema): { name: string; path: string; schema: McpSchema; required?: boolean }[] {
  if (typeof schema === 'boolean') return []
  return [
    ...Object.entries(schema.properties ?? {}).map(([name, child]) => ({ name, path: `/properties/${pointerPart(name)}`, schema: child, required: schema.required?.includes(name) ?? false })),
    ...(schema.items === undefined ? [] : [{ name: 'Items', path: '/items', schema: schema.items }]),
    ...(['anyOf', 'oneOf', 'allOf'] as const).flatMap((key) => (schema[key] ?? []).map((child, i) => ({
      name: `${key} ${i + 1}`, path: `/${key}/${i}`, schema: child,
    }))),
    ...(['$defs', 'definitions'] as const).flatMap((key) => Object.entries(schema[key] ?? {}).map(([name, child]) => ({
      name, path: `/${key}/${pointerPart(name)}`, schema: child,
    }))),
    ...(schema.additionalProperties && typeof schema.additionalProperties === 'object'
      ? [{ name: 'Additional properties', path: '/additionalProperties', schema: schema.additionalProperties as McpSchema }] : []),
  ]
}
