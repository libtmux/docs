import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const workflows = new URL('../../.github/workflows/', import.meta.url)
const NAME = 'verify-destinations.yml'
const workflow = readFileSync(new URL(NAME, workflows), 'utf8')
const others = readdirSync(workflows).filter((file) => file !== NAME)
  .map((file) => ({ file, text: readFileSync(new URL(file, workflows), 'utf8') }))
const code = (text: string) => text.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n')
const actionsIn = (text: string) => [...code(text).matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map(([, action]) => action!)
const pinned = new Set(others.flatMap(({ text }) => actionsIn(text)))

/**
 * What the weekly destination check promises, as the sentences it breaks.
 * Taking the workflow text lets the tests below plant each break and watch it
 * named, so the contract cannot pass on a file that no longer keeps it.
 */
function problems(text: string): string[] {
  const found: string[] = []
  const body = code(text)
  const triggers = /^on:\n((?:[ \t]+.*\n|\n)+)/m.exec(body)?.[1] ?? ''
  const events = [...triggers.matchAll(/^ {2}(\w+):/gm)].map(([, event]) => event)
  if (!events.includes('schedule') || !/cron:\s*'[^']+'/.test(triggers)) found.push('has no schedule')
  if (!events.includes('workflow_dispatch')) found.push('cannot be dispatched')
  for (const event of events.filter((name) => name !== 'schedule' && name !== 'workflow_dispatch')) found.push(`runs on ${event}`)
  if (!/^permissions:\n {2}contents: read\n(?![ \t]+\w)/m.test(body)) found.push('does not limit permissions to contents: read')
  if (/\bsecrets\./.test(body) || /\bid-token\b/.test(body)) found.push('uses a secret or an identity token')
  const live = /node scripts\/verify-destinations\.mjs --out "\$RUNNER_TEMP\/[\w.-]+"\s*$/m.test(body)
  if (!live) found.push('does not run the live verifier into a temporary file')
  if (/^\s*run:\s*node scripts\/verify-destinations\.mjs\s*$/m.test(body)) found.push('rewrites the committed evidence')
  const fresh = /if:\s*\$\{\{ !cancelled\(\) \}\}\n\s*run:\s*node scripts\/verify-destinations\.mjs --check --fresh\s*$/m.test(body)
  if (!fresh) found.push('does not hold the committed evidence to the age bound after a failed live run')
  const liveApi = /node scripts\/verify-api-destinations\.mjs --no-cache --out "\$RUNNER_TEMP\/[\w.-]+"\s*$/m.test(body)
  if (!liveApi) found.push('does not run the live API verifier into a temporary file')
  if (/^\s*run:\s*node scripts\/verify-api-destinations\.mjs( --no-cache)?\s*$/m.test(body)) found.push('rewrites the committed API evidence')
  const freshApi = /if:\s*\$\{\{ !cancelled\(\) \}\}\n\s*run:\s*node scripts\/verify-api-destinations\.mjs --check --fresh\s*$/m.test(body)
  if (!freshApi) found.push('does not hold the committed API evidence to the age bound after a failed live run')
  for (const action of actionsIn(text)) if (!pinned.has(action)) found.push(`uses ${action}, which no other workflow uses`)
  if (!/actions\/checkout@\S+\n\s+with:\n\s+persist-credentials: false/.test(body)) found.push('keeps credentials after checkout')
  return found
}

describe('the destination verification workflow', () => {
  it('keeps every promise of the weekly check', () => {
    expect(problems(workflow)).toEqual([])
  })

  it('runs on a schedule and on demand, and nowhere a docs change could be blocked by it', () => {
    expect(workflow).toMatch(/schedule:\n\s+- cron: '\d+ \d+ \* \* \d'/)
    expect(workflow).toContain('workflow_dispatch:')
    for (const { file, text } of others) {
      expect(text, `${file} depends on the check`).not.toMatch(/verify-destinations\.yml/)
      expect(code(text), `${file} waits on the check`).not.toMatch(/workflow_run:[\s\S]*?verify-destinations/)
    }
    // The offline gate every pull request runs must never judge age, or time alone would fail a change.
    const audit = readFileSync(new URL('../../scripts/test-all.sh', import.meta.url), 'utf8')
    const lines = code(audit).split('\n').filter((line) => line.includes('verify-destinations.mjs'))
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) {
      expect(line, 'a live request in the audit').toContain('--check')
      expect(line, 'an age gate in the audit').not.toContain('--fresh')
    }
  })

  it('names the check with the age gate and the artifact that carries the refresh', () => {
    expect(workflow).toContain('node scripts/verify-destinations.mjs --check --fresh')
    expect(workflow).toMatch(/uses: actions\/upload-artifact@v\d+\n\s+with:\n\s+name: destination-evidence/)
    expect(workflow).toContain('if-no-files-found: ignore')
    expect(workflow).toContain('node scripts/verify-api-destinations.mjs --check --fresh')
    expect(workflow).toMatch(/uses: actions\/upload-artifact@v\d+\n\s+with:\n\s+name: api-destination-evidence/)
  })

  describe('as a check that can fail', () => {
    const without = (needle: string | RegExp, replacement = '') => workflow.replace(needle, replacement)
    const planted: [string, string, string][] = [
      ['a missing schedule', without(/ {2}schedule:\n {4}- cron: '[^']+'\n/), 'has no schedule'],
      ['a missing manual trigger', without('  workflow_dispatch:\n'), 'cannot be dispatched'],
      ['a push trigger', without('on:\n', 'on:\n  push:\n    branches: [main]\n'), 'runs on push'],
      ['a pull request trigger', without('on:\n', 'on:\n  pull_request:\n'), 'runs on pull_request'],
      ['write access', without('contents: read', 'contents: write'), 'does not limit permissions to contents: read'],
      ['an extra permission', without('contents: read\n', 'contents: read\n  id-token: write\n'), 'uses a secret or an identity token'],
      ['a secret', without('run: node scripts/verify-destinations.mjs --check --fresh', 'env:\n          TOKEN: ${{ secrets.TOKEN }}\n        run: node scripts/verify-destinations.mjs --check --fresh'), 'uses a secret or an identity token'],
      ['a run over the committed evidence', without('node scripts/verify-destinations.mjs --out "$RUNNER_TEMP/destination-evidence.json"', 'node scripts/verify-destinations.mjs'), 'rewrites the committed evidence'],
      ['no live run', without('run: node scripts/verify-destinations.mjs --out "$RUNNER_TEMP/destination-evidence.json"', 'run: echo skipped'), 'does not run the live verifier into a temporary file'],
      ['an age gate that skips after a failure', without('if: ${{ !cancelled() }}\n        run: node scripts/verify-destinations.mjs --check --fresh', 'run: node scripts/verify-destinations.mjs --check --fresh'), 'does not hold the committed evidence to the age bound after a failed live run'],
      ['an age gate that is only the plain check', without('--check --fresh', '--check'), 'does not hold the committed evidence to the age bound after a failed live run'],
      ['a live API run over the committed evidence', without('node scripts/verify-api-destinations.mjs --no-cache --out "$RUNNER_TEMP/api-destination-evidence.json"', 'node scripts/verify-api-destinations.mjs'), 'rewrites the committed API evidence'],
      ['no live API run', without('run: node scripts/verify-api-destinations.mjs --no-cache --out "$RUNNER_TEMP/api-destination-evidence.json"', 'run: echo skipped'), 'does not run the live API verifier into a temporary file'],
      ['an API age gate that skips after a failure', without('if: ${{ !cancelled() }}\n        run: node scripts/verify-api-destinations.mjs --check --fresh', 'run: node scripts/verify-api-destinations.mjs --check --fresh'), 'does not hold the committed API evidence to the age bound after a failed live run'],
      ['an API age gate that is only the plain check', without('verify-api-destinations.mjs --check --fresh', 'verify-api-destinations.mjs --check'), 'does not hold the committed API evidence to the age bound after a failed live run'],
      ['an unpinned action', without('actions/setup-node@v7', 'actions/setup-node@v2'), 'uses actions/setup-node@v2, which no other workflow uses'],
      ['kept credentials', without('        with:\n          persist-credentials: false\n'), 'keeps credentials after checkout'],
    ]
    it.each(planted)('names %s', (_what, text, problem) => {
      expect(text, 'the mutation changed nothing').not.toBe(workflow)
      expect(problems(text)).toContain(problem)
    })

    it('ignores a break that only appears in a comment', () => {
      expect(problems(`# on: push\n# secrets.TOKEN\n${workflow}`)).toEqual([])
    })
  })
})
