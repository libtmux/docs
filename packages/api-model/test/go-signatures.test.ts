import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { extractWithSpec } from '../src/languages/spec.ts'
import { GO } from '../src/languages/specs.ts'

const scratch = mkdtempSync(join(tmpdir(), 'libtmux-go-signatures-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))
let sequence = 0
async function extract(source: string) {
  const file = join(scratch, `${sequence++}.go`)
  writeFileSync(file, `package tmux\n${source}\n`)
  return extractWithSpec(GO, file, 'tmux')
}

describe('Go callable source facts', () => {
  it.fails('retains the complete ListBuffers header without its implementation', async () => {
    const raw = 'func (s Server) ListBuffers(\n\tctx context.Context,\n\trequest ListBuffersRequest,\n) ([]string, error)'
    const symbols = await extract(`${raw} { return nil, nil }`)
    const method = symbols.find((symbol) => symbol.name === 'ListBuffers')!
    expect(method.signatures[0]!.raw).toBe(raw)
  })

  it.fails.each([
    ['s *Server[T]', { name: 's', type: '*Server[T]' }],
    ['s Server', { name: 's', type: 'Server' }],
    ['*Server', { name: '', type: '*Server' }],
  ])('retains the source receiver %s', async (receiver, expected) => {
    const method = (await extract(`func (${receiver}) Sessions() {}`)).find((symbol) => symbol.name === 'Sessions')!
    expect(method.signatures[0]!.receiver).toEqual(expected)
    expect(method.parent).toBe('tmux.Server')
  })

  it.fails('retains every grouped parameter in declaration order', async () => {
    const method = (await extract('func Join(a, b string, c, d *Target) {}'))[0]!
    expect(method.signatures[0]!.params).toEqual([
      { name: 'a', type: 'string' }, { name: 'b', type: 'string' },
      { name: 'c', type: '*Target' }, { name: 'd', type: '*Target' },
    ])
  })

  it.fails('retains variadic and unnamed parameter facts without inventing names', async () => {
    const symbols = await extract('func Named(first Target, rest ...Target) {}\nfunc Unnamed(string, ...Target) {}')
    expect(symbols[0]!.signatures[0]!.params).toEqual([
      { name: 'first', type: 'Target' }, { name: 'rest', type: 'Target', variadic: 'positional' },
    ])
    expect(symbols[1]!.signatures[0]!.params).toEqual([
      { name: '', type: 'string' }, { name: '', type: 'Target', variadic: 'positional' },
    ])
  })

  it.fails('retains type constraints and literal whitespace inside the source header', async () => {
    const raw = 'func Matching[T interface{ ~string | ~[]byte }](value struct { Name string `Target  tag` }, filter func(T) bool) (result []T, err error)'
    const method = (await extract(`${raw} { return nil, nil }`))[0]!
    expect(method.signatures[0]!.raw).toBe(raw)
    expect(method.signatures[0]!.typeParams).toEqual(['T interface{ ~string | ~[]byte }'])
    expect(method.signatures[0]!.params[0]!.type).toBe('struct { Name string `Target  tag` }')
  })

  it('preserves public identities, ownership, source order and export filtering', async () => {
    const symbols = await extract('type Server struct {}\nfunc hidden() {}\nfunc (s *Server) Sessions() {}\nfunc Matching[T any](values []T) []T { return values }')
    expect(symbols.map((symbol) => [symbol.id, symbol.kind, symbol.parent])).toEqual([
      ['tmux.Server', 'struct', undefined],
      ['tmux.Server.Sessions', 'method', 'tmux.Server'],
      ['tmux.Matching', 'function', undefined],
    ])
    expect(symbols[1]!.signatures).toHaveLength(1)
    expect(symbols[2]!.signatures[0]!.returns).toBe('[]T')
  })
})
