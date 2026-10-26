#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { publishAssembledInventories } from '../site/src/lib/inventory-publisher.ts'

const [directory, base] = process.argv.slice(2)
if (!directory || !base?.startsWith('/') || !base.endsWith('/')) throw new Error('Usage: publish-inventories.mjs OUTPUT /url/prefix/')
const out = resolve(directory)
const manifest = JSON.parse(readFileSync(resolve(out, 'versions.json'), 'utf8'))
const aliases = JSON.parse(readFileSync(fileURLToPath(new URL('../site/src/data/inventory-aliases.json', import.meta.url)), 'utf8'))
console.log(JSON.stringify(publishAssembledInventories(out, base, manifest, aliases)))
