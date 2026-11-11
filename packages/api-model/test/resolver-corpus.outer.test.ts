// Outer: audit the source documentation corpus against all registered port models.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { it, expect } from 'vitest'
import { API_MODEL_PORTS } from '../../../site/src/lib/ports.ts'
import { Resolver } from '../src/resolver.ts'
import { readInventory } from '../src/inventory.ts'
import { proseMentions } from '../src/mentions.ts'
import { portFromSentence } from '../src/prose.ts'
import type { ApiModel } from '../src/model.ts'
const here = dirname(fileURLToPath(import.meta.url))
const DATA = join(here, '../../../site/src/data/api')
const PORTS = API_MODEL_PORTS.map((port) => port.slug)
const r = new Resolver(PORTS.map((port) => JSON.parse(readFileSync(join(DATA, `${port}.json`), 'utf8')) as ApiModel))
const inventory = join(here, '../../../site/src/data/inventories/python.inv')
if (existsSync(inventory)) r.addInventory('Python', 'https://docs.python.org/3/', readInventory(readFileSync(inventory)).entries)

// Slow by design: one Markdown parse per page of the corpus. It outgrows vitest's 5 s
// default on a starved CI runner, so it carries its own budget (measurements: commit message).
const CORPUS_BUDGET_MS = 20_000

it('resolves most unlinked references in the real corpus', () => {
    const LABEL: Record<string, string> = {
      Python: 'py', Ruby: 'ruby', Lua: 'lua', TypeScript: 'ts', Rust: 'rs', Go: 'go',
      ...Object.fromEntries(API_MODEL_PORTS.map((port) => [port.language, port.slug])), '.NET': 'csharp',
    }
    const docs = join(here, '../../../site/src/content/docs')
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.md') ? [join(dir, e.name)] : [])
    let linkable = 0
    let resolved = 0
    for (const f of walk(docs)) {
      const [area, port] = relative(docs, f).replace(/^_staged[\\/]/, '').split(/[\\/]/)
      const owner = ['ports', '_staged'].includes(area) && PORTS.some((entry) => entry === port) ? port : undefined
      for (const mention of proseMentions(readFileSync(f, 'utf8'), LABEL, () => owner)) {
        // Authored links already select a destination, which may be a protocol
        // object or external API. The name resolver does not own those labels.
        if (mention.linked) continue
        const { text, before } = mention
        const port = portFromSentence(before) ?? mention.port
        if (!port) continue
        if (!/^[A-Za-z_.][\w.]*(\s*\(|\.)/.test(text) && !/\(\)$/.test(text)) continue
        const res = r.resolve(port, text)
        if (res.how === 'not-a-symbol') continue
        linkable++
        if (!['ambiguous', 'no-symbol'].includes(res.how)) resolved++
      }
    }
    expect(linkable).toBeGreaterThan(200)
    // Floor, not a pin. 87% at the time of writing.
    expect(resolved / linkable).toBeGreaterThan(0.8)
  }, CORPUS_BUDGET_MS)
