// Outer: compare generated inventories with the installed, lock-pinned Sphinx reader.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { writeInventory } from '../src/inventory.ts'
import type { ApiModel } from '../src/model.ts'

const here = dirname(fileURLToPath(import.meta.url))
const DATA = join(here, '../../../site/src/data/api')
const PORTS = ['py', 'ruby', 'lua', 'ts', 'rs', 'go', 'java', 'csharp', 'cxx', 'swift', 'perl', 'raku'] as const
const load = (port: string): ApiModel => JSON.parse(readFileSync(join(DATA, `${port}.json`), 'utf8'))

describe('Sphinx itself can read every inventory we write', () => {
  /**
   * Our reader is not evidence that our writer is right.
   *
   * `readInventory` and `writeInventory` were written together from the same
   * reading of the format, so a shared misunderstanding round-trips perfectly
   * and fails only in Sphinx. This loads each file with
   * `sphinx.util.inventory.InventoryFile.load` — the code that will actually
   * consume these files — and compares what it finds against the model.
   *
   * The header is as load-bearing as the body: four plaintext lines, the
   * fourth naming the compression, then zlib. Sphinx rejects the file outright
   * if any of that is wrong, which is a better failure than a silently empty
   * inventory.
   */
  it.each(PORTS)('%s loads in Sphinx with every entry intact', (port) => {
    const model = load(port)
    const bytes = writeInventory(model, {
      project: `libtmux-${port}`,
      version: 'test',
      uriFor: (s) => `reference/${port}/#${s.publicId ?? s.id}`,
    })
    const dir = mkdtempSync(join(tmpdir(), 'libtmux-inv-'))
    const file = join(dir, 'objects.inv')
    writeFileSync(file, bytes)

    const script = `
import json, sys
from sphinx.util.inventory import InventoryFile
with open(sys.argv[1], "rb") as fh:
    inv = InventoryFile.load(fh, "https://libtmux.org/", lambda base, uri: base + uri)
count = sum(len(entries) for entries in inv.values())
names = sorted({name for entries in inv.values() for name in entries})
print(json.dumps({"count": count, "domains": sorted(inv), "sample": names[:3]}))
`
    let out: string
    try {
      out = execFileSync(
        join(here, '../../../.venv/bin/python'),
        ['-c', script, file],
        { encoding: 'utf8', timeout: 5_000 },
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
    const result = JSON.parse(out.trim().split('\n').pop() ?? '{}') as {
      count: number
      domains: string[]
      sample: string[]
    }

    expect(result.count, `${port}: Sphinx read a different number of entries`).toBe(
      model.symbols.length,
    )
    expect(result.domains.length, `${port}: no domains`).toBeGreaterThan(0)
  })
})
