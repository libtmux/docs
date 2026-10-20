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
 *
 * `--port <slug> --checkout <dir> --revision <rev>` instead resolves every
 * `file=` fence of that port, whole or an excerpt, on every content page
 * against the committed bytes of the checkout at the revision. The example
 * cache binds a page to the revision recorded in the port's model, but the
 * port's own docs build reads its trunk, so a page can pass here and fail
 * there. Run it against a port's trunk before pinning that port.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LANG_TO_PORT } from '../site/src/plugins/remark-port-code.mjs'
import { PORTS } from '../site/src/lib/ports.ts'
import { checkExampleBlocks, checkQuotedSources, fencesOf } from '../site/src/lib/example-blocks.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const option = (name, fallback) => {
  const at = process.argv.indexOf(name)
  return at === -1 ? fallback : resolve(process.argv[at + 1])
}
const CONTENT = option('--content', join(root, 'site/src/content/docs'))
const FIXTURES = option('--fixtures', join(root, 'site/test/fixtures'))
const CACHE = JSON.parse(readFileSync(option('--sources', join(root, 'site/src/data/example-sources.json')), 'utf8'))
const value = (name) => {
  const at = process.argv.indexOf(name)
  return at === -1 ? undefined : process.argv[at + 1]
}

/** Every Markdown page under a directory. */
function markdownTree(directory) {
  return readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? markdownTree(path) : entry.name.endsWith('.md') ? [path] : []
  })
}

if (['--port', '--checkout', '--revision'].some((name) => process.argv.includes(name))) {
  const usage = 'usage: check-example-blocks.mjs --port <slug> --checkout <dir> --revision <rev>'
  const [port, revision] = [value('--port'), value('--revision')]
  const checkout = value('--checkout') && resolve(value('--checkout'))
  if (!port || !checkout || !revision || revision.startsWith('-')) {
    console.error(usage)
    process.exit(2)
  }
  if (!PORTS.some((known) => known.slug === port)) {
    console.error(`check-example-blocks: ${port} is not a port; ${usage}`)
    process.exit(2)
  }
  const git = (...args) => execFileSync('git', ['-C', checkout, ...args], { encoding: 'utf8', maxBuffer: 1 << 24, stdio: ['ignore', 'pipe', 'pipe'] })
  let commit
  try {
    commit = git('rev-parse', '--verify', '--quiet', `${revision}^{commit}`).trim()
  } catch {
    console.error(`check-example-blocks: ${revision} is not a commit of ${checkout}`)
    process.exit(2)
  }
  const sources = new Map()
  const readSource = (file) => {
    if (!sources.has(file)) {
      try {
        sources.set(file, git('show', `${commit}:${file}`))
      } catch {
        sources.set(file, undefined)
      }
    }
    return sources.get(file)
  }
  const where = `${port} at ${commit.slice(0, 8)}`
  const failures = []
  let fences = 0
  for (const file of markdownTree(CONTENT)) {
    const page = file.slice(CONTENT.length + 1).replace(/\.md$/, '')
    // Blank lines stand in for the frontmatter, so a line number is the file's.
    const markdown = readFileSync(file, 'utf8').replace(/^---\n[\s\S]*?\n---\n/, (head) => '\n'.repeat(head.split('\n').length - 1))
    fences += fencesOf(markdown).filter((fence) => LANG_TO_PORT[fence.language] === port && /\bfile=/.test(fence.meta)).length
    for (const problem of checkQuotedSources({ markdown, owner: port, ownerOf: (language) => LANG_TO_PORT[language], readSource, where })) {
      failures.push(`${page}: ${problem}`)
    }
  }
  if (failures.length) {
    console.error(`check-example-blocks: ${failures.length} of ${fences} file= fences of ${port} do not resolve at ${commit}\n${failures.map((line) => `  ${line}`).join('\n')}`)
    process.exit(1)
  }
  console.log(`check-example-blocks: ${fences} file= fences of ${port} resolve at ${commit}`)
  process.exit(0)
}

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
  // On a port page a bare `/examples/...` link stays in that port, so a link
  // meant for the shared tmux page can land on the page itself.
  const route = /^route:\s*(\S+)/m.exec(readFileSync(file, 'utf8'))?.[1]
  if (page.startsWith('ports/') && route) {
    for (const [, href] of markdown.matchAll(/\]\((\/[^)\s#]*)[^)]*\)/g)) {
      if (href.replace(/\/+$/, '') === `/${route}`) failures.push(`${page}: ${href} links to the page itself; link the shared page as /tmux/${route}/`)
    }
  }
}

if (failures.length) {
  console.error(`check-example-blocks: ${failures.length} problem(s) on example pages\n${failures.map((line) => `  ${line}`).join('\n')}`)
  process.exit(1)
}
console.log(`check-example-blocks: ${blocks} code blocks on ${pages.length} example pages are excerpts or recorded runs`)
