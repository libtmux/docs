import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

export const rakuDigest = (value) => createHash('sha256').update(value).digest('hex')

/**
 * Parse trusted library source with the compiler the checkout pins, never with JavaScript syntax rules.
 * RakuAST can run compile-time code, so only a reviewed library revision is read this way.
 */
export function nativeRakuScan(text, checkout) {
  const result = spawnSync(process.env.LIBTMUX_DOCS_RAKU || 'raku', [
    ...(checkout ? ['-I.'] : []), fileURLToPath(new URL('./tmux-usage-raku.raku', import.meta.url)),
  ], { cwd: checkout, input: text, encoding: 'utf8', maxBuffer: 64 << 20 })
  if (result.error || result.status !== 0) throw new Error(`Native Raku source scan failed: ${result.error?.message ?? result.stderr}`)
  return { ...JSON.parse(result.stdout), sha256: rakuDigest(text) }
}

/** Dynamic Invocation plans need reviewed dispatch and scope claims, as the native Perl reader does. */
export function scanRaku(text, native, { commands, known }) {
  if (!text) return { functions: [], types: [], orphans: [] }
  if (!native || native.sha256 !== rakuDigest(text)) throw new Error('Raku analysis requires native input for these exact bytes')
  const functions = native.functions.map(({ literals, calls, ...fn }) => ({
    ...fn,
    sites: literals.filter(({ value }) => known.has(value) && commands.has(value)).map(({ value, line }) => ({
      command: value, line, flags: '', dispatch: null,
      why: 'RakuAST literal in an Invocation plan; dispatch and scope require reviewed source evidence',
    })),
    calls: new Map(calls.map(({ name, line }) => [name, line])),
    receivers: new Map(calls.map(({ name, receiver }) => [name, new Set(receiver ? [receiver] : [])])),
    callList: calls,
  }))
  return { functions, types: native.types, orphans: [] }
}
