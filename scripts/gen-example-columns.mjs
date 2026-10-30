#!/usr/bin/env node
/**
 * Rewrite the example-width baseline from the content tree.
 *
 * `site/test/example-columns.test.ts` requires the baseline to match the tree
 * exactly, so a page that gained or lost over-budget lines needs this run.
 * Like the other ratchets, it only lowers: a page that grew, or one the
 * baseline does not list, is refused unless `--force` says the growth is
 * intended. A first baseline is growth from nothing and needs `--force`.
 * `--rename old=new` carries a page's entry to its new path, provided the
 * page has no more lines over than the entry recorded; it is repeatable.
 *
 * `--content <dir>` and `--baseline <file>` point at other paths, which the
 * test uses to run the script against a planted tree.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { measureExampleColumns, raisedPages, renamePages } from '../site/src/lib/example-columns.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const option = (name, fallback) => {
  const at = process.argv.indexOf(name)
  return at === -1 ? fallback : resolve(process.argv[at + 1])
}
const CONTENT = option('--content', join(root, 'site/src/content/docs'))
const BASELINE = option('--baseline', join(root, 'site/test/fixtures/example-columns.json'))

const renames = process.argv.flatMap((arg, at) => (process.argv[at - 1] === '--rename' ? [arg.split(/=(.*)/s).slice(0, 2)] : []))
if (renames.some(([from, to]) => !from || !to)) {
  console.error('usage: gen-example-columns.mjs [--rename old=new]... [--force]')
  process.exit(2)
}
const measured = await measureExampleColumns(CONTENT)
const stored = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {}
const { baseline: recorded, problems } = renamePages(stored, measured, renames)
if (problems.length) {
  console.error('gen-example-columns: refusing to rename.')
  for (const problem of problems) console.error(`  ${problem}`)
  process.exit(1)
}
const raised = raisedPages(measured, recorded)
if (raised.length && !process.argv.includes('--force')) {
  console.error('gen-example-columns: refusing to raise the baseline.')
  for (const page of raised) console.error(`  ${page}: ${recorded[page] ?? 0} -> ${measured[page]}`)
  console.error('Shorten those lines, pass --rename old=new for a moved page, or pass --force if the growth is intended.')
  process.exit(1)
}
writeFileSync(BASELINE, `${JSON.stringify(measured, null, 2)}\n`)
const lines = Object.values(measured).reduce((sum, count) => sum + count, 0)
console.log(`gen-example-columns: ${Object.keys(measured).length} pages, ${lines} lines over budget`)
