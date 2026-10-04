import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { extractWithSpec } from '../src/languages/spec.ts'
import { TYPESCRIPT } from '../src/languages/specs.ts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

async function extract(source: string) {
  const dir = mkdtempSync(join(tmpdir(), 'typescript-api-'))
  dirs.push(dir)
  const file = join(dir, 'server.ts')
  writeFileSync(file, source)
  return extractWithSpec(TYPESCRIPT, file, 'server')
}

describe('TypeScript signatures and parameter documentation', () => {
  it('moves inline option comments into the parameter without losing outer @param text', async () => {
    const symbols = await extract(`
      /** Create a server.
       * @param options - Controls the server.
       */
      export function create(tmux: Server, options: {
        /** The host pane environment. See {@link Server}. */
        readonly callerEnvironment?: Readonly<Record<string, string | undefined>>;
        /** Policy input. */
        readonly environment?: Readonly<Record<string, string | undefined>>;
        readonly policy?: Policy;
        /** Startup observations. */
        readonly startup?: ServerStartup;
      } = {}): McpServer { throw new Error(); }
    `)
    const signature = symbols[0].signatures[0]
    expect(signature.params[0]).toMatchObject({ name: 'tmux', type: 'Server' })
    const options = signature.params[1]
    expect(options.default).toBe('{}')
    expect(options.type).toBe(
      `{\n  readonly callerEnvironment?: Readonly<Record<string, string | undefined>>;\n  readonly environment?: Readonly<Record<string, string | undefined>>;\n  readonly policy?: Policy;\n  readonly startup?: ServerStartup;\n}`,
    )
    expect(options.doc).toContain('Controls the server.')
    expect(options.doc).toContain('- `callerEnvironment`: The host pane environment. See {@link Server}.')
    expect(options.doc).toContain('- `environment`: Policy input.')
    expect(options.doc).toContain('- `startup`: Startup observations.')
    expect(signature.returns).toBe('McpServer')
  })

  it('preserves literals, optional parameters, rest parameters and nested field paths', async () => {
    const symbols = await extract(`
      export class Settings { readonly mode: "// literal  spaces"; }
      export function open(options?: {
        transport: {
          /** Remote address. */
          url: "https://example.test/*value*/";
        };
      }, ...keys: string[]): "/* literal */" { throw new Error(); }
      export function isText(value: unknown): value is string { return true; }
      export function assertText(value: unknown): asserts value is string { return; }
    `)
    expect(symbols.find((symbol) => symbol.name === 'mode')?.type).toBe('"// literal  spaces"')
    const signature = symbols.find((symbol) => symbol.name === 'open')!.signatures[0]
    expect(signature.params[0]).toMatchObject({
      name: 'options',
      optional: true,
      doc: '- `transport.url`: Remote address.',
    })
    expect(signature.params[0].type).toContain('"https://example.test/*value*/"')
    expect(signature.params[1]).toMatchObject({ name: 'keys', variadic: 'positional', type: 'string[]' })
    expect(signature.returns).toBe('"/* literal */"')
    expect(symbols.find((symbol) => symbol.name === 'isText')!.signatures[0].returns).toBe('value is string')
    expect(symbols.find((symbol) => symbol.name === 'assertText')!.signatures[0].returns).toBe(
      'asserts value is string',
    )
  })
})
