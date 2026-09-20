import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PORTS } from '../src/lib/ports'

const reusable = readFileSync(new URL('../../.github/workflows/reusable-deploy.yml', import.meta.url), 'utf8')
const shell = readFileSync(new URL('../../.github/workflows/deploy-shell.yml', import.meta.url), 'utf8')

describe('port publisher contract', () => {
  it('reserves every port and requires its exact port/version prefix', () => {
    const reserved = reusable.match(/reserved=\(([^)]+)\)/)?.[1].trim().split(/\s+/)
    expect(reserved).toEqual([...PORTS.map((port) => port.slug), 'manifest', '_shell'])
    expect(reusable).toContain('"$p" != "$PORT_IN/$VERSION_IN"')
    expect(reusable).toContain('^pr-[0-9]+$')
    expect(reusable).toContain('PR previews cannot be defaults')
  })

  it('protects immutable releases before upload and excludes previews from production manifests', () => {
    expect(reusable).toContain("if: inputs.version-kind == 'tag'")
    expect(reusable).toContain('diff -qr dist "$remote"')
    expect(reusable).toContain('immutable tag \'$PREFIX\' already exists with different bytes')
    expect(reusable).toContain("if: inputs.port != '' && inputs.version-kind != 'pr'")
  })

  it('merges successful per-port fragments into both runtime switchers on the next shell publish', () => {
    expect(shell).toContain('Merge successfully published port versions')
    expect(shell).toContain('merge-version-manifests.mjs')
    expect(shell).toContain('manifest/$port.json')
  })
})
