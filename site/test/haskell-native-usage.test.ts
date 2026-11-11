import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { scanPort } from '../../scripts/gen-tmux-usage.mjs'
import { verifyClaims } from '../../scripts/lib/tmux-usage-derive.mjs'

const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const sources = new Map([
  ['src/LibTmux/Server.hs', 'module LibTmux.Server where\nimport Control.Exception (mask_)\nimport LibTmux.Internal.Queue qualified as Queue\nwithServer action = action ()\ncapture = mask_ $ Queue.submit Queue.ReadSnapshot\n'],
  ['internal/LibTmux/Internal/Queue.hs', 'module LibTmux.Internal.Queue where\ndata ReadCommand = ReadSnapshot | Dormant\narguments ReadSnapshot = ["display-message", "-p", "-F", "#{S:#{session_id}}"]\narguments Dormant = ["list-panes", "-a"]\nsubmit command = native (arguments command)\n'],
  ['cbits/process.c', 'int native_spawn(void) { return 0; }\n'],
  ['libtmux-haskell.cabal', 'name: libtmux-haskell\n'],
])
const directory = mkdtempSync(join(tmpdir(), 'haskell-native-usage-'))
for (const [path, content] of sources) {
  mkdirSync(dirname(join(directory, path)), { recursive: true })
  writeFileSync(join(directory, path), content)
}
execFileSync('git', ['init', '--quiet', directory])
execFileSync('git', ['-C', directory, 'add', '.'])
execFileSync('git', ['-C', directory, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'Source fixture'])
const revision = execFileSync('git', ['-C', directory, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const model = { port: 'haskell', repo: 'libtmux/libtmux-haskell', revision, nativeProvenance: { exporter: { version: 2, build: { compiler: 'ghc-9.14.1' } } }, symbols: [
  { id: 'LibTmux.Server#v:capture', name: 'capture', kind: 'function', source: { file: 'src/LibTmux/Server.hs', line: 5 } },
  { id: 'LibTmux.Server#v:withServer', name: 'withServer', kind: 'function', source: { file: 'src/LibTmux/Server.hs', line: 4 } },
] }
const claims = [{
  port: 'haskell', revision, symbol: 'LibTmux.Server#v:capture', command: 'display-message', scope: null,
  evidence: [
    { at: 'src/LibTmux/Server.hs:5', has: ['capture = mask_', 'Queue.submit Queue.ReadSnapshot'], in: 'LibTmux.Server#v:capture' },
    { at: 'internal/LibTmux/Internal/Queue.hs:5', has: ['submit command = native'] },
    { at: 'internal/LibTmux/Internal/Queue.hs:3', has: ['arguments ReadSnapshot', '"display-message"'] },
  ],
}]
// The catalogue is an explicit review, not an interpretation of the test's queued action.
const profile = {
  schemaVersion: 1, repository: model.repo, revision,
  files: Object.fromEntries([...sources].map(([path, content]) => [path, digest(content)])),
  modelSha256: digest(JSON.stringify({ symbols: model.symbols, build: model.nativeProvenance.exporter.build })),
  claimsSha256: digest(JSON.stringify(claims)),
  classifications: [
    { kind: 'sends', why: 'The snapshot request submits this fixed command.', symbols: ['LibTmux.Server#v:capture'] },
    { kind: 'caller-io', why: 'The caller supplies the action; the wrapper sends no command of its own.', symbols: ['LibTmux.Server#v:withServer'] },
  ],
}
const commands = new Set(['display-message', 'list-panes'])
const options = { port: 'haskell', model, commands, checkout: directory, known: commands, dispatch: new Set<string>(),
  builders: undefined, guards: undefined, labels: undefined, trace: undefined, nativeProfile: profile, nativeClaims: claims }
afterAll(() => rmSync(directory, { recursive: true, force: true }))

describe('reviewed native Haskell usage', () => {
  it('credits only the reviewed public request, keeping callbacks and dormant commands separate', async () => {
    const scanned = await scanPort(options)
    expect(scanned.functions.flatMap((fn) => fn.sites)).toEqual([])
    const result = verifyClaims({ claims, symbols: scanned.symbols, functions: scanned.functions, types: scanned.types, readSource: scanned.readSource })
    expect(result.problems).toEqual([])
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0]).toMatchObject({ symbol: 'LibTmux.Server#v:capture', command: 'display-message', reviewed: true })
  })

  it.each([
    ['revision', { ...profile, revision: '0'.repeat(40) }, /native Haskell.*revision/i],
    ['source bytes', { ...profile, files: { ...profile.files, 'cbits/process.c': '0'.repeat(64) } }, /native Haskell.*cbits\/process.c/i],
    ['missing source', { ...profile, files: Object.fromEntries(Object.entries(profile.files).filter(([path]) => !path.startsWith('internal/'))) }, /native Haskell.*source inventory/i],
    ['unclassified public action', { ...profile, classifications: profile.classifications.slice(1) }, /native Haskell.*classification/i],
    ['duplicate classification', { ...profile, classifications: [...profile.classifications, profile.classifications[0]] }, /native Haskell.*classification/i],
    ['claim drift', { ...profile, claimsSha256: '0'.repeat(64) }, /native Haskell.*claims/i],
  ])('rejects stale %s before returning a declaration index', async (_name, nativeProfile, failure) => {
    await expect(scanPort({ ...options, nativeProfile })).rejects.toThrow(failure)
  })

  it('requires a reviewed profile for the native capture surface', async () => {
    await expect(scanPort({ ...options, nativeProfile: undefined })).rejects.toThrow(/native Haskell.*no reviewed profile/i)
  })

  it.each([
    { ...model, symbols: model.symbols.slice(1) },
    { ...model, symbols: model.symbols.map((symbol) => ({ ...symbol, signatures: [{ raw: 'capture :: IO ()' }] })) },
    { ...model, nativeProvenance: { exporter: { version: 2, build: { compiler: 'ghc-other' } } } },
  ])('rejects model and effect-boundary drift even when the native source is unchanged', async (changed) => {
    await expect(scanPort({ ...options, model: changed })).rejects.toThrow(/native Haskell.*public model or native build/i)
  })
})
