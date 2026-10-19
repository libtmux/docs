import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { API_MODEL_PORTS } from '../src/lib/ports'

/** Run the real type-link check over rendered markup with a ceiling of zero, so every plain name it counts is reported. */
export function auditTypeLinks(html: string) {
  const directory = mkdtempSync(join(tmpdir(), 'libtmux-signature-audit-'))
  try {
    for (const { slug } of API_MODEL_PORTS) {
      const destination = join(directory, slug, 'latest', 'reference', 'probe')
      mkdirSync(destination, { recursive: true })
      writeFileSync(join(destination, 'index.html'), html)
    }
    const ceiling = join(directory, 'ceiling.json')
    writeFileSync(ceiling, JSON.stringify(Object.fromEntries(API_MODEL_PORTS.map(({ slug }) => [slug, 0]))))
    try {
      const output = execFileSync(process.execPath, [fileURLToPath(new URL('../../scripts/check-type-links.mjs', import.meta.url)), directory, '--ceiling', ceiling], { encoding: 'utf8', stdio: 'pipe' })
      return { code: 0, output }
    } catch (error) {
      const result = error as { status: number; stdout: string; stderr: string }
      return { code: result.status, output: `${result.stdout}${result.stderr}` }
    }
  } finally { rmSync(directory, { recursive: true, force: true }) }
}
