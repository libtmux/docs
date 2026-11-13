import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

/**
 * Converts the vendored Haskell grammar from YAML to the JSON Shiki loads.
 *
 * The workspace has no YAML parser, so the package comes from YAML_MODULE,
 * the path of an installed `yaml` entry point (see the README beside the
 * grammar). With --check it compares the committed JSON with the conversion
 * and exits 1 on a difference; otherwise it rewrites the JSON and its digest
 * in provenance.json.
 */
const dir = new URL('../src/vendor/haskell-grammar/', import.meta.url)
const read = (name) => readFileSync(new URL(name, dir), 'utf8')
const { parse } = await import(process.env.YAML_MODULE ? pathToFileURL(process.env.YAML_MODULE).href : 'yaml')

const converted = `${JSON.stringify(parse(read('haskell.YAML-tmLanguage')), null, 2)}\n`
const provenance = JSON.parse(read('provenance.json'))
const digest = createHash('sha256').update(converted).digest('hex')

if (process.argv.includes('--check')) {
  if (read(provenance.derivedCopy.file) !== converted) {
    console.error(`${provenance.derivedCopy.file} is not the conversion of ${provenance.asset}`)
    process.exit(1)
  }
} else {
  provenance.derivedCopy.sha256 = digest
  writeFileSync(new URL(provenance.derivedCopy.file, dir), converted)
  writeFileSync(new URL('provenance.json', dir), `${JSON.stringify(provenance, null, 2)}\n`)
}
console.log(`${provenance.derivedCopy.file} sha256 ${digest}`)
