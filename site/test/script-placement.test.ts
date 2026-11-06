import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const src = fileURLToPath(new URL('../src/', import.meta.url))

/**
 * A script after a layout's closing tag is written after `</html>`, and runs
 * only once every module script ahead of it has loaded, including a beacon the
 * zone injects before `</body>`. Required scripts sit inside the layout.
 */
it('no component writes a script after the layout it renders', () => {
  const late: string[] = []
  for (const file of readdirSync(src, { recursive: true }) as string[]) {
    if (!file.endsWith('.astro')) continue
    const source = readFileSync(join(src, file), 'utf8').replace(/^---\n[\s\S]*?\n---\n/, '')
    const closes = [...source.matchAll(/<\/(\w*Layout\w*|NativeShell)>/g)]
    if (closes.length === 0) continue
    const last = closes[closes.length - 1]!
    if (/<script\b/.test(source.slice(last.index + last[0].length))) late.push(file)
  }
  expect(late).toEqual([])
})
