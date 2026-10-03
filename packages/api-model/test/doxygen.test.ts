import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { extractDoxygen } from '../src/languages/doxygen.ts'

function extractCompound(xml: string) {
  const dir = mkdtempSync(join(tmpdir(), 'libtmux-api-doxygen-'))
  try {
    writeFileSync(join(dir, 'class.xml'), `<doxygen>${xml}</doxygen>`)
    return extractDoxygen(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('Doxygen public inheritance', () => {
  it('keeps public bases without exposing private or protected implementation bases', () => {
    const symbols = extractCompound(`
      <compounddef kind="class">
        <compoundname>libtmux::Pane</compoundname>
        <basecompoundref prot="private" virt="non-virtual">libtmux::Row</basecompoundref>
        <basecompoundref prot="public" virt="virtual">libtmux::Readable</basecompoundref>
        <basecompoundref prot="protected" virt="non-virtual">libtmux::State</basecompoundref>
        <basecompoundref prot="public" virt="non-virtual">std::formatter&lt;std::string&gt;</basecompoundref>
        <location file="include/libtmux/pane.hpp" line="12"/>
      </compounddef>`)

    expect(symbols).toHaveLength(1)
    expect(symbols[0]).toMatchObject({
      id: 'libtmux::Pane',
      publicId: 'libtmux::Pane',
      extends: ['libtmux::Readable', 'std::formatter<std::string>'],
      source: { file: 'include/libtmux/pane.hpp', line: 12 },
    })
  })

  it('retains a public member even when its implementation base is private', () => {
    const symbols = extractCompound(`
      <compounddef kind="class">
        <compoundname>libtmux::Pane</compoundname>
        <basecompoundref prot="private" virt="non-virtual">libtmux::Row</basecompoundref>
        <sectiondef kind="public-func">
          <memberdef kind="function" prot="public">
            <type>const Server &amp;</type>
            <name>server</name>
            <location file="include/libtmux/row.hpp" line="42"/>
          </memberdef>
        </sectiondef>
        <location file="include/libtmux/pane.hpp" line="12"/>
      </compounddef>`)

    expect(symbols[0].extends).toBeUndefined()
    expect(symbols[1]).toMatchObject({
      id: 'libtmux::Pane::server',
      parent: 'libtmux::Pane',
      kind: 'method',
      signatures: [{ params: [], returns: 'const Server &' }],
    })
  })
})
