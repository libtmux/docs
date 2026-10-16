import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'
import type { ApiModel } from '@libtmux/api-model'

it.fails('resolves native callable grammars and the parser runtime after SSR bundling', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url))
  const require = createRequire(realpathSync(new URL('../node_modules/astro/package.json', import.meta.url)))
  const { build } = await import(/* @vite-ignore */ pathToFileURL(require.resolve('vite')).href)
  const directory = mkdtempSync(join(tmpdir(), 'libtmux-jvm-layout-'))
  try {
    // Model the dependency visibility of Astro's output without building a
    // documentation tree, importing its config, or starting a server.
    symlinkSync(join(root, 'node_modules'), join(directory, 'node_modules'), 'junction')
    const entry = join(directory, 'native-entry.ts')
    writeFileSync(entry, `export { apiSignatureLayouts } from ${JSON.stringify(join(root, 'src/lib/code-layout.ts'))};
export { jvmSignatureLayout } from ${JSON.stringify(join(root, 'src/lib/jvm-code-layout.ts'))};
export { goSignatureLayout } from ${JSON.stringify(join(root, 'src/lib/go-code-layout.ts'))};`)
    await build({ configFile: false, root, logLevel: 'silent', build: {
      ssr: entry, outDir: directory, emptyOutDir: false,
      rolldownOptions: { output: { entryFileNames: 'entry.mjs' } },
    } })
    const cases = (['scala', 'kotlin'] as const).map((port) => {
      const model = JSON.parse(readFileSync(new URL(`../src/data/api/${port}.json`, import.meta.url), 'utf8')) as ApiModel
      const symbol = model.symbols.find((entry) => entry.name === 'sessions' && entry.signatures.some((signature) => signature.receiver?.type === 'Server'))!
      return { port, signature: symbol.signatures.find((signature) => signature.params.length === 0)! }
    })
    const go = JSON.parse(readFileSync(new URL('../src/data/api/go.json', import.meta.url), 'utf8')) as ApiModel
    const symbol = go.symbols.find((entry) => entry.id === 'tmux.Server.ListBuffers')!
    const java = JSON.parse(readFileSync(new URL('../src/data/api/java.json', import.meta.url), 'utf8')) as ApiModel
    const javaSymbol = java.symbols.find((entry) => entry.id === 'io.github.libtmux.Server.Server.sessions')!
    writeFileSync(join(directory, 'probe.mjs'), `import { apiSignatureLayouts, jvmSignatureLayout, goSignatureLayout } from './entry.mjs';
const results = await Promise.all(${JSON.stringify(cases)}.map(async ({port, signature}) => ({port, ...await jvmSignatureLayout(signature, port)})));
const symbol = ${JSON.stringify(symbol)};
results.push({port: 'go', ...await goSignatureLayout(symbol, symbol.signatures[0])});
const java = ${JSON.stringify(javaSymbol)};
for (const layout of (await apiSignatureLayouts(java, 'java')).values()) results.push({port: 'java', ...layout});
console.log(JSON.stringify(results));`)
    const results = JSON.parse(execFileSync(process.execPath, ['probe.mjs'], { cwd: directory, encoding: 'utf8' }))
    expect(results).toEqual([
      expect.objectContaining({ port: 'scala', text: 'extension (self: Server) def sessions(): Vector[Session]', failures: [] }),
      expect.objectContaining({ port: 'kotlin', text: 'public suspend fun Server.sessions(): List<Session>', failures: [] }),
      expect.objectContaining({ port: 'go', text: 'func (s Server) ListBuffers(\n\tctx context.Context,\n\trequest ListBuffersRequest,\n) ([]string, error)', failures: [] }),
      expect.objectContaining({ port: 'java', text: '@ReadOnly\n@Operation(Kind.READ)\npublic List<Session> sessions(\n        FilterExpr<Session> expression)', failures: [] }),
      expect.objectContaining({ port: 'java', text: '@ReadOnly\n@Operation(Kind.READ)\npublic List<Session> sessions()', failures: [] }),
    ])
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
