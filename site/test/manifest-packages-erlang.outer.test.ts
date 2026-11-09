import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { readPort } from '../../scripts/lib/manifest-packages.mjs'

const runtime = spawnSync('erl', ['+S', '2:2', '-noshell', '-eval', 'io:put_chars(erlang:system_info(otp_release)), halt().'], { encoding: 'utf8', timeout: 5000, maxBuffer: 1024 })
const available = runtime.status === 0 && runtime.stdout === '29'
const ci = !!process.env.CI && !['0', 'false'].includes(process.env.CI)
const repo = (files: Record<string, string>) => ({ revision: 'fixture',
  files: () => Object.keys(files), read: (path: string) => files[path]!,
  has: (path: string) => path in files, tags: () => [],
})

it('requires OTP 29 on CI for native application manifests', () => {
  if (ci && !available) throw new Error('Install OTP 29 for Erlang manifest checks')
})

// Outer: parses real application terms with the selected OTP runtime.
describe.skipIf(!available)('Erlang application manifests', () => {
  it('reads source-installed umbrella apps without inventing a package for assets', () => {
    const files = {
      'apps/libtmux_erlang/src/libtmux_erlang.app.src': '% {vsn,"wrong"}\n{application, libtmux_erlang, [{description,"{vsn, wrong}"}, {vsn,"0.0.0+development"}]}.',
      'apps/libtmux_erlang_workspace/src/libtmux_erlang_workspace.app.src': '{application, libtmux_erlang_workspace, [{vsn,"0.0.0+development"}]}.',
      'apps/libtmux_erlang_mcp/README.md': 'Artwork only.',
      '_build/default/lib/old/src/old.app.src': '{application, old, [{vsn,"9"}]}.',
    }
    expect(readPort('erlang', repo(files))).toEqual({ distributions: [
      { name: 'libtmux_erlang', version: '0.0.0+development', manifest: 'apps/libtmux_erlang/src/libtmux_erlang.app.src' },
      { name: 'libtmux_erlang_workspace', version: '0.0.0+development', manifest: 'apps/libtmux_erlang_workspace/src/libtmux_erlang_workspace.app.src' },
    ], units: [] })
  })

  it('rejects ambiguous metadata, mismatched app names and executable expressions', () => {
    for (const term of [
      '{application, probe, [{vsn,"1"},{vsn,"2"}]}.',
      '{application, another, [{vsn,"1"}]}.',
      '{application, probe, [{vsn, atom_to_list(probe)}]}.',
      '{application, probe, [{vsn, [[]]}]}.',
      '{application, probe, [{vsn, [[],[]]}]}.',
      '{application, probe, [{vsn, ["1"]}]}.',
      '{application, probe, [{vsn, [<<"1">>]}]}.',
    ]) {
      expect(() => readPort('erlang', repo({ 'src/probe.app.src': term }))).toThrow('Invalid Erlang application manifest')
    }
  })
})
