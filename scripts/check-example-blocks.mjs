#!/usr/bin/env node
/**
 * Fail when a code block on an example page is not backed by a tested source.
 *
 * Example pages build up to a program that a native run executes. Each block
 * must be an excerpt of that program, a file whose bytes the run recorded, the
 * recorded command, or its recorded output. A block typed by hand can drift
 * from the code without any test noticing.
 *
 * `--content <dir>` and `--fixtures <dir>` point at other trees, which the
 * negative test uses to plant a hand-typed block.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LANG_TO_PORT } from '../site/src/plugins/remark-port-code.mjs'
import { checkExampleBlocks, fencesOf } from '../site/src/lib/example-blocks.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const option = (name, fallback) => {
  const at = process.argv.indexOf(name)
  return at === -1 ? fallback : resolve(process.argv[at + 1])
}
const CONTENT = option('--content', join(root, 'site/src/content/docs'))
const FIXTURES = option('--fixtures', join(root, 'site/test/fixtures'))
const CACHE = JSON.parse(readFileSync(option('--sources', join(root, 'site/src/data/example-sources.json')), 'utf8'))

/** Ports whose example pages are built up from excerpts; add a port as its pages convert. */
const BUILT_UP_PORTS = ['go']

const pages = [
  ...markdownIn(join(CONTENT, 'examples')),
  ...BUILT_UP_PORTS.flatMap((port) => markdownIn(join(CONTENT, 'ports', port, 'examples'))),
]

function markdownIn(directory) {
  return existsSync(directory)
    ? readdirSync(directory).filter((name) => name.endsWith('.md')).sort().map((name) => join(directory, name))
    : []
}

/** What the recorded native runs cover, by page id such as `examples/capture-pane-output`. */
function records() {
  const byPage = new Map()
  const add = (page, { files = [], commands = [], outputs = [] }) => {
    const record = byPage.get(page) ?? { files: new Map(), commands: new Set(), outputs: new Set() }
    for (const { name, sha256 } of files) record.files.set(name, new Set([...(record.files.get(name) ?? []), sha256]))
    for (const command of commands) record.commands.add(command)
    for (const output of outputs) record.outputs.add(output)
    byPage.set(page, record)
  }
  for (const name of readdirSync(FIXTURES).filter((file) => file.endsWith('-examples.json')).sort()) {
    const fixture = JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'))
    for (const example of fixture.examples ?? []) {
      if (!example.page) continue
      add(example.page, {
        files: example.files,
        commands: example.shellRecipe,
        outputs: [...(example.expectedOutputs ?? []).flat(), ...(example.expectedOutput ? [example.expectedOutput] : [])],
      })
    }
    if (fixture.rootWorkspace) add(fixture.rootWorkspace.page, { files: fixture.rootWorkspace.files, commands: fixture.rootWorkspace.shellRecipe })
    if (fixture.rootExample) add(fixture.page, { files: [{ name: fixture.rootExample.file, sha256: fixture.rootExample.sha256 }], commands: [fixture.rootExample.shellRecipe] })
  }
  return byPage
}

const recorded = records()
let blocks = 0
const failures = []
for (const file of pages) {
  const page = file.slice(CONTENT.length + 1).replace(/\.md$/, '')
  const markdown = readFileSync(file, 'utf8').replace(/^---\n[\s\S]*?\n---\n/, '')
  blocks += fencesOf(markdown).length
  const problems = checkExampleBlocks({
    markdown,
    record: recorded.get(page),
    ownerOf: (language) => LANG_TO_PORT[language],
    readCached: (owner, source) => CACHE[`${owner}:${source}`]?.content,
  })
  for (const problem of problems) failures.push(`${page}: ${problem}`)
}

if (failures.length) {
  console.error(`check-example-blocks: ${failures.length} code block(s) not backed by a tested source\n${failures.map((line) => `  ${line}`).join('\n')}`)
  process.exit(1)
}
console.log(`check-example-blocks: ${blocks} code blocks on ${pages.length} example pages are excerpts or recorded runs`)
