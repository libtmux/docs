import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { scanSource } from '../../scripts/lib/tmux-usage-scan.mjs'

const text = "package LibTmux::Server;\nsub create($self) {\n$self->_cmd_op(['new-session']);\n}\n=pod\nkill-server\n=cut\n"
const native = () => ({
  sha256: createHash('sha256').update(text).digest('hex'),
  functions: [{ name: 'create', owner: 'LibTmux::Server', start: 2, nameLine: 2, end: 4, kind: 'function' }],
  types: [{ name: 'LibTmux::Server', start: 1, end: 7 }],
  tokens: [
    { t: 'sym', v: '$self', line: 3, function: 0 },
    { t: 'sym', v: '->', line: 3, function: 0 },
    { t: 'id', v: '_cmd_op', line: 3, function: 0 },
    { t: 'sym', v: '(', line: 3, function: 0 },
    { t: 'str', v: 'new-session', line: 3, function: 0 },
  ],
})
const options = { grammar: 'perl', text, commands: new Set(['new-session', 'kill-server']), known: new Set(['new-session', 'kill-server']) }

describe('source-bound native PPI command analysis', () => {
  it('retains package ownership and calls without treating POD as code', async () => {
    const result = await scanSource({ ...options, native: native() })
    expect(result.functions[0]?.owner).toBe('LibTmux::Server')
    expect(result.functions[0]?.calls.get('_cmd_op')).toBe(3)
    expect([...result.functions[0]!.receivers.get('_cmd_op')!]).toEqual(['self'])
    expect(result.functions[0]?.sites.map(({ command }) => command)).toEqual(['new-session'])
    expect(result.functions[0]?.sites[0]?.dispatch).toBeNull()
  })
  it('refuses absent or stale native parser input', async () => {
    await expect(scanSource(options)).rejects.toThrow(/native PPI/)
    await expect(scanSource({ ...options, native: { ...native(), sha256: '0'.repeat(64) } })).rejects.toThrow(/exact bytes/)
  })
})
