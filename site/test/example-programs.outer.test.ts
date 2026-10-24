import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterAll, expect, it } from 'vitest'
import { SourceBinding, verifyExamplePrograms } from '../src/lib/example-programs.mjs'

const scratch = mkdtempSync(join(tmpdir(), 'libtmux-astro-binding-'))
const site = fileURLToPath(new URL('../', import.meta.url))
const sha256 = (value: Buffer) => createHash('sha256').update(value).digest('hex')
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

it('binds Markdown, MDX and repeated content-collection builds, and rejects a changed MDX component', () => {
  for (const changed of [false, true]) {
    const root = join(scratch, changed ? 'changed' : 'ordinary')
    mkdirSync(join(root, 'src/pages'), { recursive: true })
    symlinkSync(join(site, 'node_modules'), join(root, 'node_modules'))
    writeFileSync(join(root, 'package.json'), '{"type":"module"}\n')
    const adapter = pathToFileURL(join(site, 'src/lib/example-programs.mjs')).href
    writeFileSync(join(root, 'astro.config.mjs'), `import { defineConfig } from 'astro/config'
import { unified } from '@astrojs/markdown-remark'
import mdx from '@astrojs/mdx'
import expressiveCode from 'astro-expressive-code'
import { exampleProgramsFromEnvironment, exampleProgramsIntegration } from ${JSON.stringify(adapter)}
export default defineConfig({ integrations: [expressiveCode(), mdx(), ...exampleProgramsIntegration(exampleProgramsFromEnvironment())], markdown: { processor: unified({}) } })
`)
    const source = 'import { basename } from "node:path"\n\n\nif (true) {\n\tconsole.log(basename("<copied>&.js"))\n}'
    const names = ['plain.md', 'component.mdx']
    for (const name of names) writeFileSync(join(root, 'src/pages', name),
      `---\ntitle: Copied program\n---\n\n${changed && name.endsWith('.mdx') ? 'export const components = { code: () => <code>substituted</code> }\n\n' : ''}\`\`\`javascript\n${source}\n\`\`\`\n`)
    mkdirSync(join(root, 'src/content/docs'), { recursive: true })
    writeFileSync(join(root, 'src/content/docs/collected.md'), `---\ntitle: Collection program\n---\n\n\`\`\`javascript\n${source}\n\`\`\`\n`)
    writeFileSync(join(root, 'src/content.config.ts'), `import { defineCollection } from 'astro:content'
import { glob } from 'astro/loaders'
export const collections = { docs: defineCollection({ loader: glob({ pattern: '**/*.md', base: './src/content/docs' }) }) }
`)
    writeFileSync(join(root, 'src/pages/[...slug].astro'), `---
import { getCollection, render } from 'astro:content'
export async function getStaticPaths() {
  return (await getCollection('docs')).map(entry => ({ params: { slug: entry.id }, props: { entry } }))
}
const { Content } = await render(Astro.props.entry)
---
<html><body><Content /></body></html>
`)
    const recipe = join(root, 'recipe.json')
    const pages = [...names.map((name) => 'src/pages/' + name), 'src/content/docs/collected.md']
    writeFileSync(recipe, JSON.stringify({ schema: 1, programs: pages.map((document) => ({ id: document.split('/').at(-1)!.split('.')[0],
      document, rendered: document.split('/').at(-1)!.split('.')[0] + '/index.html',
      files: [{ path: 'copied.mjs', language: 'javascript', block: 0 }], commands: [[process.execPath, 'copied.mjs']], stdout: '<copied>&.js\n' })) }))
    const inputs = [recipe, join(root, 'astro.config.mjs'), join(root, 'src/content.config.ts'),
      join(root, 'src/pages/[...slug].astro'), ...pages.map((path) => join(root, path))]
    const binding = join(root, 'binding.json')
    const receipt = join(root, 'render.json')
    writeFileSync(binding, JSON.stringify({ schema: 1, runId: root,
      inputs: Object.fromEntries(inputs.map((path) => [path, sha256(readFileSync(path))])) }))
    const build = (receipt: string, output: string) => spawnSync(process.execPath,
      [join(site, 'node_modules/astro/bin/astro.mjs'), 'build', '--root', root, '--outDir', output],
      { encoding: 'utf8', timeout: 15000, env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1',
        LIBTMUX_EXAMPLE_BINDING: binding, LIBTMUX_EXAMPLE_RECIPE: recipe, LIBTMUX_EXAMPLE_RENDER_RECEIPT: receipt } })
    const built = build(receipt, join(root, 'dist'))
    if (changed) {
      expect(built.status).toBe(1)
      expect(built.stderr).toContain('Displayed code differs from its Copy payload')
      expect(JSON.parse(readFileSync(receipt, 'utf8')).passed).toBe(false)
    } else {
      expect(built.status, built.stdout + built.stderr).toBe(0)
      const result = verifyExamplePrograms(new SourceBinding(binding), receipt)
      expect(result.record.programs).toHaveLength(3)
      for (const program of result.record.programs) {
        const file = program.files[0]
        expect(file.authoredText).toBe(source)
        expect(file.text).toBe(source.replace('\t', '  '))
        expect(file.copiedText).toBe(file.text)
        const executed = spawnSync(process.execPath, [join(site, 'scripts/markdown-examples.mjs'), 'run',
          '--binding', binding, '--render-receipt', receipt, '--program', program.id,
          '--receipt', join(root, program.id + '.run.json'), '--output-dir', join(root, program.id + '.program')],
        { encoding: 'utf8', timeout: 5000 })
        expect(executed.status, executed.stderr).toBe(0)
      }
      const repeatedReceipt = join(root, 'repeat.render.json')
      const repeated = build(repeatedReceipt, join(root, 'repeat-dist'))
      expect(repeated.status, repeated.stdout + repeated.stderr).toBe(0)
      const repeatedResult = verifyExamplePrograms(new SourceBinding(binding), repeatedReceipt)
      expect(repeatedResult.record.programs).toHaveLength(3)
      expect(repeatedResult.record.cacheDirectory).not.toBe(result.record.cacheDirectory)
      expect(repeatedResult.record.documents).toEqual(result.record.documents)
    }
  }
}, 30000)

it('rejects an MDX component that swaps fenced bodies and their Copy payloads together', () => {
  const root = join(scratch, 'swapped')
  mkdirSync(join(root, 'src/pages'), { recursive: true })
  symlinkSync(join(site, 'node_modules'), join(root, 'node_modules'))
  writeFileSync(join(root, 'package.json'), '{"type":"module"}\n')
  const config = join(root, 'astro.config.mjs')
  writeFileSync(config, `import { defineConfig } from 'astro/config'
import { unified } from '@astrojs/markdown-remark'
import mdx from '@astrojs/mdx'
import expressiveCode from 'astro-expressive-code'
import { exampleProgramsFromEnvironment, exampleProgramsIntegration } from ${JSON.stringify(pathToFileURL(join(site, 'src/lib/example-programs.mjs')).href)}
export default defineConfig({ integrations: [expressiveCode(), mdx(), ...exampleProgramsIntegration(exampleProgramsFromEnvironment())], markdown: { processor: unified({}) } })
`)
  const document = join(root, 'src/pages/swapped.mdx')
  writeFileSync(document, `export const components = {
  pre: (props) => <pre {...props}><code>{props['data-language'] === 'javascript' ? 'console.log("second")' : 'console.log("first")'}</code></pre>,
  button: (props) => <button {...props} data-code={props['data-code']?.replace(/first|second/g, value => value === 'first' ? 'second' : 'first')} />
}

\`\`\`javascript
console.log("first")
\`\`\`

\`\`\`typescript
console.log("second")
\`\`\`
`)
  const recipe = join(root, 'recipe.json')
  writeFileSync(recipe, JSON.stringify({ schema: 1, programs: [{ id: 'swapped', document, rendered: 'swapped/index.html',
    files: [{ path: 'copied.mjs', language: 'javascript', block: 0 }], commands: [[process.execPath, 'copied.mjs']], stdout: 'first\n' }] }))
  const binding = join(root, 'binding.json')
  const receipt = join(root, 'render.json')
  writeFileSync(binding, JSON.stringify({ schema: 1, runId: root,
    inputs: Object.fromEntries([config, document, recipe].map((path) => [path, sha256(readFileSync(path))])) }))
  const built = spawnSync(process.execPath, [join(site, 'node_modules/astro/bin/astro.mjs'), 'build', '--root', root],
    { encoding: 'utf8', timeout: 15000, env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1',
      LIBTMUX_EXAMPLE_BINDING: binding, LIBTMUX_EXAMPLE_RECIPE: recipe, LIBTMUX_EXAMPLE_RENDER_RECEIPT: receipt } })
  expect(built.status, built.stdout + built.stderr).toBe(1)
  expect(built.stderr).toContain('Final page differs from native collected code')
  expect(JSON.parse(readFileSync(receipt, 'utf8')).passed).toBe(false)
}, 20000)
