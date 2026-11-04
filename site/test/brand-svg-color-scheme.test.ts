import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

/**
 * Pages show the site's SVGs through `<img>`, where a `prefers-color-scheme`
 * rule inside the file does not reliably follow the site's Light, Dark or
 * System choice. A mark that turns white for a dark phone then sits white on a
 * page the reader set to Light. The page sets the mark's colour from its own
 * resolved theme instead. Every SVG under public/ is held to this, not only the
 * brand artwork: the registry icons are images too, and any of them can be
 * shown through <img>.
 */
const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url))

/** The SVG files below `dir` whose own style follows the device's colour scheme. */
function followingTheDevice(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...followingTheDevice(path))
    else if (entry.name.endsWith('.svg') && /prefers-color-scheme/i.test(readFileSync(path, 'utf8'))) found.push(path)
  }
  return found
}

const scratch: string[] = []
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('the SVGs a page shows through <img>', () => {
  it('leave their colour to the page, so none carries a prefers-color-scheme rule', () => {
    expect(followingTheDevice(PUBLIC).map((path) => relative(PUBLIC, path))).toEqual([])
  })

  it('are found by the scan when one does', () => {
    const dir = mkdtempSync(join(tmpdir(), 'brand-svg-'))
    scratch.push(dir)
    mkdirSync(join(dir, 'languages', 'rs'), { recursive: true })
    writeFileSync(join(dir, 'languages', 'rs', 'icon.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg"><style>@media (prefers-color-scheme: dark) { #logo { fill: #fff } }</style><path id="logo" d="M0 0h1v1z"/></svg>')
    writeFileSync(join(dir, 'languages', 'rs', 'plain.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1v1z"/></svg>')
    // A tree shaped like public/: the brand artwork, a registry icon and the root favicon.
    const rule = '<svg xmlns="http://www.w3.org/2000/svg"><style>@media (prefers-color-scheme: dark) { path { fill: #fff } }</style><path d="M0 0h1v1z"/></svg>'
    mkdirSync(join(dir, 'icons'))
    writeFileSync(join(dir, 'icons', 'registry.svg'), rule)
    writeFileSync(join(dir, 'favicon.svg'), rule)
    expect(followingTheDevice(dir).map((path) => relative(dir, path)).sort()).toEqual(['favicon.svg', join('icons', 'registry.svg'), join('languages', 'rs', 'icon.svg')])
  })
})
