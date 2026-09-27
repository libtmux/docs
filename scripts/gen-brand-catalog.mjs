#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

const root = new URL('../site/public/brand/', import.meta.url)
const path = new URL('catalog.json', root)
const catalog = JSON.parse(readFileSync(path, 'utf8'))
const files = catalog.assets.flatMap((asset) => asset.files)
for (const file of files) {
  const bytes = readFileSync(new URL(file.file, root))
  file.bytes = bytes.length
  file.sha256 = createHash('sha256').update(bytes).digest('hex')
}
catalog.fileCount = files.length
writeFileSync(path, `${JSON.stringify(catalog, null, 2)}\n`)
console.log(`Brand catalog: ${files.length} file sizes and digests`)
