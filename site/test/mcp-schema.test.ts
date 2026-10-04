import { describe, expect, it } from 'vitest'
import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { experimental_AstroContainer } from 'astro/container'
import { Window } from 'happy-dom'
import {
  inlineSchemaItem,
  schemaAnchor,
  schemaChildren,
  schemaConstraints,
  schemaDefinitions,
  schemaReference,
  schemaType,
  schemaTypeParts,
  type McpSchema,
} from '../src/lib/mcp-schema'

describe('MCP structured schemas', () => {
  const schema: McpSchema = {
    type: 'object',
    required: ['pane/id'],
    additionalProperties: false,
    properties: {
      'pane/id': { type: 'string', description: 'The target pane.' },
      settings: { type: 'object', properties: { timeout: { type: ['integer', 'null'], default: 0, minimum: 0 } } },
      panes: { type: 'array', items: { $ref: '#/$defs/pane~1ref' } },
      mode: { oneOf: [{ const: 'read' }, { const: 'write' }] },
    },
    $defs: { 'pane/ref': { type: 'object', properties: { id: { type: 'string' } } } },
  }

  it('gives escaped nested fields independent identities and preserves required metadata', () => {
    const fields = schemaChildren(schema)
    expect(fields.find((field) => field.name === 'pane/id')).toMatchObject({
      path: '/properties/pane~1id',
      required: true,
    })
    expect(fields.find((field) => field.name === 'settings')).toMatchObject({ required: false })
    const settings = fields.find((field) => field.name === 'settings')!
    const timeout = schemaChildren(settings.schema)[0]
    const pointer = settings.path + timeout.path
    expect(schemaAnchor('mcp.tool.test.input', pointer)).toBe(
      'mcp.tool.test.input/properties/settings/properties/timeout',
    )
    expect(schemaAnchor('mcp.tool.test.output', pointer)).not.toBe(schemaAnchor('mcp.tool.test.input', pointer))
    expect(schemaConstraints(timeout.schema)).toEqual([
      ['default', '0'],
      ['minimum', '0'],
    ])
    expect(schemaConstraints(schema)).toEqual([['additionalProperties', 'false']])
  })

  it('links actual definitions and refuses external or absent references', () => {
    const reference = schemaReference(schema, '#/$defs/pane~1ref', 'mcp.tool.test.input')!
    const definition = schemaChildren(schema).find((child) => child.path === '/$defs/pane~1ref')!
    expect(decodeURIComponent(reference.slice(1))).toBe(schemaAnchor('mcp.tool.test.input', definition.path))
    for (const invalid of [
      'https://example.com/schema.json#/$defs/pane',
      '#/$defs/missing',
      '#/%zz',
      '#/properties/settings/type',
    ]) {
      expect(schemaReference(schema, invalid, 'mcp.tool.test.input')).toBeUndefined()
    }
  })

  it('preserves unions, arrays, literal choices and unconstrained schemas', () => {
    const fields = schemaChildren(schema)
    expect(schemaType(fields.find((field) => field.name === 'panes')!.schema)).toBe('Array<pane/ref>')
    const mode = fields.find((field) => field.name === 'mode')!
    expect(schemaType(mode.schema)).toBe('"read" | "write"')
    expect(schemaChildren(mode.schema).map((child) => child.path)).toEqual(['/oneOf/0', '/oneOf/1'])
    expect(schemaType({ allOf: [{ type: 'string' }, { enum: ['read'] }] })).toBe('string & "read"')
    expect(schemaType(true)).toBe('any value')
    expect(schemaType(false)).toBe('no value')
    expect(schemaType({})).toBe('any value')
    expect(schemaChildren(false)).toEqual([])
  })

  it('links element and union types without changing their displayed notation', () => {
    const array: McpSchema = { type: 'array', items: { anyOf: [{ $ref: '#/$defs/pane~1ref' }, { type: 'null' }] } }
    const parts = schemaTypeParts(array, schema, 'output')
    expect(parts.map((part) => part.text).join('')).toBe(schemaType(array))
    expect(parts.filter((part) => part.href).map((part) => [part.text, part.href])).toEqual([
      ['Array', 'https://json-schema.org/understanding-json-schema/reference/array'],
      ['pane/ref', '#output%2F%24defs%2Fpane~1ref'],
      ['null', 'https://json-schema.org/understanding-json-schema/reference/null'],
    ])
    expect(schemaTypeParts({ $ref: '#/$defs/absent' }, schema, 'output')[0].href).toBeUndefined()
    expect(schemaTypeParts({ const: 'object' }, schema, 'output')).toEqual([{ text: '"object"' }])
    expect(schemaTypeParts({ type: ['integer', 'null'] }, schema, 'output').filter((part) => part.href)).toHaveLength(2)
    const nullable: McpSchema = { type: ['array', 'null'], items: { type: 'string' } }
    expect(schemaType(nullable)).toBe('Array<string> | null')
    expect(
      schemaTypeParts(nullable, schema, 'output')
        .map((part) => part.text)
        .join(''),
    ).toBe('Array<string> | null')
    expect(
      schemaTypeParts(nullable, schema, 'output')
        .filter((part) => part.href)
        .map((part) => part.text),
    ).toEqual(['Array', 'string', 'null'])
    const singleton: McpSchema = { type: ['array'], items: { type: 'integer' } }
    expect(schemaType(singleton)).toBe('Array<integer>')
    expect(
      schemaTypeParts(singleton, schema, 'output')
        .map((part) => part.text)
        .join(''),
    ).toBe('Array<integer>')
  })

  it('separates named types while preserving nested definition paths', () => {
    const nested: McpSchema = {
      properties: { value: { $defs: { Local: { type: 'string' } } } },
      definitions: { Result: { type: 'object', $defs: { Child: { type: 'boolean' } } } },
    }
    expect(schemaDefinitions(nested).map((entry) => entry.path)).toEqual([
      '/properties/value/$defs/Local',
      '/definitions/Result',
      '/definitions/Result/$defs/Child',
    ])
    for (const entry of schemaDefinitions(nested))
      expect(schemaReference(nested, `#${entry.path}`, 'output')).toBe(`#${encodeURIComponent('output' + entry.path)}`)
    expect(inlineSchemaItem({ $ref: '#/definitions/Result' })).toBe(true)
    expect(inlineSchemaItem({ type: 'string', description: 'Keep this explanation.' })).toBe(false)
    expect(inlineSchemaItem({ type: 'string', minLength: 1 })).toBe(false)
  })

  it('renders constraints on a named type itself and each field exactly once', async () => {
    const astroRequire = createRequire(realpathSync(new URL('../node_modules/astro/package.json', import.meta.url)))
    const { transform } = await import(astroRequire.resolve('@astrojs/compiler-rs'))
    const compile = async (name: string, imports: Record<string, string>) => {
      const file = new URL(`../src/components/mcp/${name}.astro`, import.meta.url)
      const result = await transform(readFileSync(file, 'utf8').replace(/<style[\s\S]*?<\/style>/g, ''), {
        filename: file.pathname,
        internalURL: 'astro/compiler-runtime',
        resultScopedSlot: true,
        resolvePath: (specifier: string) => specifier,
      })
      expect(result.diagnostics.filter((entry: { severity: string }) => entry.severity === 'error')).toEqual([])
      let code = result.code.replaceAll(
        '"astro/compiler-runtime"',
        JSON.stringify(pathToFileURL(astroRequire.resolve('astro/compiler-runtime')).href),
      )
      for (const [specifier, target] of Object.entries(imports))
        code = code.replaceAll(JSON.stringify(specifier), JSON.stringify(target))
      return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
    }
    const imports = { '../../lib/mcp-schema': new URL('../src/lib/mcp-schema.ts', import.meta.url).href }
    const type = await compile('McpSchemaType', imports)
    const fields = await compile('McpSchema', {
      ...imports,
      './McpSchemaType.astro': type,
      // These fixtures have no description prose; keep the rendering check independent of the full catalog.
      '../../lib/mcp-reference': 'data:text/javascript,export const renderToolDescription = async () => ""',
    })
    const component = (await import(/* @vite-ignore */ fields)).default
    const container = await experimental_AstroContainer.create()
    const win = new Window()
    try {
      for (const fixture of [
        { type: 'integer', format: 'int32' },
        { type: 'object', additionalProperties: false, properties: { height: { type: 'integer', minimum: 1 } } },
      ]) {
        win.document.body.innerHTML = await container.renderToString(component, {
          props: { schema: fixture, scope: 'output/$defs/Type', port: 'rs', version: 'latest' },
        })
        const facts = [...win.document.querySelectorAll('dl.api-parameter-facts dt')].map((entry) => [
          entry.textContent,
          entry.nextElementSibling?.textContent,
        ])
        expect(facts).toEqual(
          fixture.format
            ? [['format', '"int32"']]
            : [
                ['additionalProperties', 'false'],
                ['minimum', '1'],
              ],
        )
      }
    } finally {
      await win.happyDOM.abort()
    }
  })
})
