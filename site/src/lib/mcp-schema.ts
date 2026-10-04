/** JSON Schema pointers keep nested fields and definitions independently linkable. */
export type McpSchema =
  | boolean
  | {
      [key: string]: unknown
      type?: string | string[]
      description?: string
      properties?: Record<string, McpSchema>
      required?: string[]
      items?: McpSchema
      $ref?: string
      $defs?: Record<string, McpSchema>
      definitions?: Record<string, McpSchema>
      anyOf?: McpSchema[]
      oneOf?: McpSchema[]
      allOf?: McpSchema[]
    }

export const pointerPart = (name: string) => name.replaceAll('~', '~0').replaceAll('/', '~1')
export const schemaAnchor = (scope: string, pointer: string) => `${scope}${pointer}`

const SCHEMA_TYPES: Record<string, string> = {
  object: 'object',
  array: 'array',
  string: 'string',
  integer: 'numeric',
  number: 'numeric',
  boolean: 'boolean',
  null: 'null',
}
export interface SchemaTypePart {
  text: string
  href?: string
}

/** Link each type token, including references nested inside containers and unions. */
export function schemaTypeParts(schema: McpSchema, root: McpSchema, scope: string): SchemaTypePart[] {
  const literal = (text: string): SchemaTypePart[] => [{ text }]
  const primitive = (name: string): SchemaTypePart => ({
    text: name,
    ...(SCHEMA_TYPES[name]
      ? { href: `https://json-schema.org/understanding-json-schema/reference/${SCHEMA_TYPES[name]}` }
      : {}),
  })
  const join = (parts: SchemaTypePart[][], separator: string) =>
    parts.flatMap((part, i) => (i ? [{ text: separator }, ...part] : part))
  if (typeof schema === 'boolean') return literal(schemaType(schema))
  if (schema.$ref) return [{ text: schemaType(schema), href: schemaReference(root, schema.$ref, scope) }]
  if (Object.hasOwn(schema, 'const') || Array.isArray(schema.enum)) return literal(schemaType(schema))
  const alternatives = schema.anyOf ?? schema.oneOf ?? schema.allOf
  if (alternatives)
    return join(
      alternatives.map((part) => schemaTypeParts(part, root, scope)),
      schema.allOf ? ' & ' : ' | ',
    )
  const named = (name: string): SchemaTypePart[] =>
    name === 'array'
      ? [
          { ...primitive('array'), text: 'Array' },
          { text: '<' },
          ...schemaTypeParts(schema.items ?? true, root, scope),
          { text: '>' },
        ]
      : [primitive(name)]
  return Array.isArray(schema.type) ? join(schema.type.map(named), ' | ') : named(schema.type ?? schemaType(schema))
}

export const isSchemaDefinition = (path: string) => /^\/(?:\$defs|definitions)\//.test(path)

/** Named definitions have their own section while retaining original pointer identities. */
export function schemaDefinitions(
  schema: McpSchema,
  pointer = '',
): { name: string; path: string; schema: McpSchema }[] {
  return schemaChildren(schema).flatMap((child) => [
    ...(isSchemaDefinition(child.path) ? [{ ...child, path: pointer + child.path }] : []),
    ...schemaDefinitions(child.schema, pointer + child.path),
  ])
}

/** A bare array item is already documented by its linked element type. */
export function inlineSchemaItem(schema: McpSchema): boolean {
  return (
    !schemaChildren(schema).length &&
    !schemaConstraints(schema).length &&
    (typeof schema === 'boolean' || !schema.description)
  )
}

export function schemaType(schema: McpSchema): string {
  if (typeof schema === 'boolean') return schema ? 'any value' : 'no value'
  if (schema.$ref) return schema.$ref.split('/').at(-1)!.replaceAll('~1', '/').replaceAll('~0', '~')
  if (Object.hasOwn(schema, 'const')) return JSON.stringify(schema.const)
  if (Array.isArray(schema.enum)) return schema.enum.map((value) => JSON.stringify(value)).join(' | ')
  const alternatives = schema.anyOf ?? schema.oneOf ?? schema.allOf
  if (alternatives) return alternatives.map(schemaType).join(schema.allOf ? ' & ' : ' | ')
  const named = (name: string) =>
    name === 'array' ? `Array<${schema.items === undefined ? 'any value' : schemaType(schema.items)}>` : name
  return Array.isArray(schema.type)
    ? schema.type.map(named).join(' | ')
    : named(schema.type ?? (schema.properties ? 'object' : 'any value'))
}

/** A reference links only when its JSON pointer resolves inside this schema. */
export function schemaReference(root: McpSchema, ref: string, scope: string): string | undefined {
  if (!ref.startsWith('#/')) return undefined
  let target: unknown = root
  let pointer: string
  try {
    pointer = decodeURIComponent(ref.slice(1))
  } catch {
    return undefined
  }
  for (const part of pointer.slice(1).split('/')) {
    const key = part.replaceAll('~1', '/').replaceAll('~0', '~')
    if (!target || typeof target !== 'object' || !Object.hasOwn(target, key)) return undefined
    target = (target as Record<string, unknown>)[key]
  }
  const rendered = (schema: McpSchema, prefix = ''): boolean =>
    schemaChildren(schema).some(
      (child) => prefix + child.path === pointer || rendered(child.schema, prefix + child.path),
    )
  if (!rendered(root)) return undefined
  return `#${encodeURIComponent(schemaAnchor(scope, pointer))}`
}

const CONSTRAINTS = [
  'default',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'pattern',
  'format',
  'minItems',
  'maxItems',
  'uniqueItems',
  'minProperties',
  'maxProperties',
  'additionalProperties',
  'readOnly',
  'writeOnly',
  'deprecated',
  'contentEncoding',
  'contentMediaType',
  'x-maxUtf8Bytes',
]
export function schemaConstraints(schema: McpSchema): [string, string][] {
  if (typeof schema === 'boolean') return []
  return CONSTRAINTS.filter(
    (key) => Object.hasOwn(schema, key) && (typeof schema[key] !== 'object' || schema[key] === null),
  ).map((key) => [key, JSON.stringify(schema[key])])
}

export function schemaChildren(
  schema: McpSchema,
): { name: string; path: string; schema: McpSchema; required?: boolean }[] {
  if (typeof schema === 'boolean') return []
  return [
    ...Object.entries(schema.properties ?? {}).map(([name, child]) => ({
      name,
      path: `/properties/${pointerPart(name)}`,
      schema: child,
      required: schema.required?.includes(name) ?? false,
    })),
    ...(schema.items === undefined ? [] : [{ name: 'Items', path: '/items', schema: schema.items }]),
    ...(['anyOf', 'oneOf', 'allOf'] as const).flatMap((key) =>
      (schema[key] ?? []).map((child, i) => ({
        name: `${key} ${i + 1}`,
        path: `/${key}/${i}`,
        schema: child,
      })),
    ),
    ...(['$defs', 'definitions'] as const).flatMap((key) =>
      Object.entries(schema[key] ?? {}).map(([name, child]) => ({
        name,
        path: `/${key}/${pointerPart(name)}`,
        schema: child,
      })),
    ),
    ...(schema.additionalProperties && typeof schema.additionalProperties === 'object'
      ? [
          {
            name: 'Additional properties',
            path: '/additionalProperties',
            schema: schema.additionalProperties as McpSchema,
          },
        ]
      : []),
  ]
}
