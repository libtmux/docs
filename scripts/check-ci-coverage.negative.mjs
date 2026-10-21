#!/usr/bin/env node
/*
 * Proof that check-ci-coverage can fail, and that it passes the real files.
 *
 * Each case copies test-all.sh and test.yml, plants one defect with a text
 * replacement, and runs the real script on the copies. A replacement that
 * changes nothing aborts the case, so a rewrite of either file cannot turn a
 * case into a second control. The unmodified copies must exit 0: without that
 * a script that always failed would pass every case here.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const script = join(root, 'scripts/check-ci-coverage.mjs')
const audit = readFileSync(join(root, 'scripts/test-all.sh'), 'utf8')
const workflow = readFileSync(join(root, '.github/workflows/test.yml'), 'utf8')

const swap = (find, replace) => (text) => {
  assert.ok(text.includes(find), `the file no longer contains ${JSON.stringify(find)}; update the case`)
  return text.replaceAll(find, replace)
}
const chain = (...changes) => (text) => changes.reduce((current, change) => change(current), text)
const dropJob = (id) => (text) => {
  const lines = text.split('\n')
  const start = lines.indexOf(`  ${id}:`)
  assert.notEqual(start, -1, `test.yml has no ${id} job; update the case`)
  let end = start + 1
  while (end < lines.length && !/^ {2}[A-Za-z0-9_-]+:\s*$/.test(lines[end])) end += 1
  return [...lines.slice(0, start), ...lines.slice(end)].join('\n')
}
const inJob = (id, line) => swap(`\n  ${id}:\n`, `\n  ${id}:\n${line}\n`)

const cases = [
  { name: 'a stage whose job was dropped', workflow: dropJob('production'), trips: /no job in test\.yml runs `--stage production`, so "production root renders" never run/ },
  { name: 'a job pointed at another stage', workflow: swap('--stage output', '--stage build'), trips: /no job in test\.yml runs `--stage output`, so "production render inputs", "preview isolation", "output tests"/ },
  { name: 'a job that runs a stage test-all.sh does not define', workflow: swap('--stage production', '--stage prodution'), trips: /job "production" runs `--stage prodution`, which test-all\.sh does not define/ },
  { name: 'a stage job left out of the test job\'s needs', workflow: swap('needs: [source, build, production, output]', 'needs: [source, build, production]'), trips: /the `test` job does not need "output", which runs `--stage output`/ },
  { name: 'a test job that a failed audit would skip', workflow: swap('    if: ${{ !cancelled() }}\n', ''), trips: /the `test` job has `if: `, not `!cancelled\(\)`/ },
  { name: 'a test job that runs on always(), which also runs after a cancel', workflow: swap('    if: ${{ !cancelled() }}\n', '    if: ${{ always() }}\n'), trips: /the `test` job has `if: always\(\)`, not `!cancelled\(\)`/ },
  { name: 'a test job that is also skipped when false', workflow: swap('    if: ${{ !cancelled() }}\n', '    if: ${{ !cancelled() && false }}\n'), trips: /the `test` job has `if: !cancelled\(\) && false`, not `!cancelled\(\)`/ },
  { name: 'a stage job skipped on a push', workflow: inJob('source', "    if: github.event_name == 'pull_request'"), trips: /job "source" runs `--stage source` but can skip it: `if: github\.event_name == 'pull_request'`/ },
  { name: 'a preview-only stage job limited to pushes', workflow: swap("  production:\n    if: github.event_name == 'pull_request'", "  production:\n    if: github.event_name == 'push'"), trips: /job "production" runs `--stage production` but can skip it/ },
  { name: 'a stage job that waits with a condition that is also false', workflow: swap("!cancelled() && needs.build.result == 'success' &&", '!cancelled() && false &&'), trips: /job "output" runs `--stage output` but can skip it: `if: !cancelled\(\) && false && \(needs\.production/ },
  { name: 'a stage job that no longer requires the production renders', workflow: swap("(needs.production.result == 'success' || github.event_name != 'pull_request')", "needs.production.result != 'failure'"), trips: /job "output" runs `--stage output` but can skip it/ },
  { name: 'a stage job that is skipped when false', workflow: inJob('source', '    if: ${{ !cancelled() && false }}'), trips: /job "source" runs `--stage source` but can skip it: `if: !cancelled\(\) && false`/ },
  { name: 'a step that runs the stage only if false', workflow: swap('      - name: test-all --stage output\n', '      - name: test-all --stage output\n        if: false\n'), trips: /job "output" runs `--stage output` in a step that can skip it: `if: false`/ },
  { name: 'a run step replaced by an echo and a comment naming the stage', workflow: swap('          if [[ "$GITHUB_EVENT_NAME" == pull_request ]]; then\n            pnpm test:publication --preview "$PREVIEW_PREFIX" --stage output\n          else\n            pnpm test:publication --stage output\n          fi\n', '          echo "audits skipped"\n          # pnpm test:publication --preview "$PREVIEW_PREFIX" --stage output\n'), trips: /no job in test\.yml runs `--stage output`/ },
  { name: 'a run step replaced by an echo and a trailing comment naming the stage', workflow: swap('        run: pnpm test:publication --preview "$PREVIEW_PREFIX" --stage production\n', '        run: echo "audits skipped" # pnpm test:publication --preview "$PREVIEW_PREFIX" --stage production\n'), trips: /no job in test\.yml runs `--stage production`/ },
  { name: 'a run step that only prints the command', workflow: chain(swap('            pnpm test:publication --preview "$PREVIEW_PREFIX" --stage source\n', '            echo "pnpm test:publication --preview $PREVIEW_PREFIX --stage source"\n'), swap('            pnpm test:publication --stage source\n', '            echo "pnpm test:publication --stage source"\n')), trips: /no job in test\.yml runs `--stage source`/ },
  { name: 'a run step that never reaches the command', workflow: chain(swap('            pnpm test:publication --preview "$PREVIEW_PREFIX" --stage build\n', '            false && pnpm test:publication --preview "$PREVIEW_PREFIX" --stage build\n'), swap('            pnpm test:publication --stage build\n', '            false && pnpm test:publication --stage build\n')), trips: /no job in test\.yml runs `--stage build`/ },
  { name: 'a stage job that continues on error', workflow: inJob('build', '    continue-on-error: true'), trips: /job "build" runs `--stage build` with continue-on-error/ },
  { name: 'a check outside every stage', audit: swap('# stage: source\n', "step 'orphaned check'\n# stage: source\n"), trips: /check "orphaned check" in .* comes before the first `# stage:` marker/ },
  { name: 'a stage marker without its guard', audit: swap(' && stage_wanted source; then', '; then'), trips: /stage "source" in .* has no `stage_wanted source` guard under its marker/ },
  { name: 'a new stage that no job runs', audit: swap('# stage: output\n', "# stage: extra\nstage_wanted extra || true\nstep 'extra check'\n# stage: output\n"), trips: /no job in test\.yml runs `--stage extra`, so "extra check" never run/ },
  { name: 'a --stage option that rejects a stage', audit: swap('=~ ^(source|build|production|output)$', '=~ ^(source|build|output)$'), trips: /`--stage` accepts source\|build\|output, not the markers source\|build\|production\|output/ },
]

const scratch = mkdtempSync(join(tmpdir(), 'libtmux-ci-coverage-'))
function run(name, auditText, workflowText) {
  const base = join(scratch, name.replaceAll(/\W+/g, '-'))
  writeFileSync(`${base}.sh`, auditText)
  writeFileSync(`${base}.yml`, workflowText)
  return spawnSync(process.execPath, [script, '--audit', `${base}.sh`, '--workflow', `${base}.yml`], { encoding: 'utf8' })
}

try {
  const clean = run('clean', audit, workflow)
  assert.equal(clean.status, 0, `the unmodified files must pass:\n${clean.stderr}`)
  console.log('ok   the unmodified test-all.sh and test.yml pass')

  for (const { name, audit: changeAudit = (text) => text, workflow: changeWorkflow = (text) => text, trips } of cases) {
    const result = run(name, changeAudit(audit), changeWorkflow(workflow))
    assert.equal(result.status, 1, `${name}: expected a failure, got ${result.status}\n${result.stdout}`)
    assert.match(result.stderr, trips, `${name}: wrong reason\n${result.stderr}`)
    console.log(`ok   fails on ${name}`)
  }
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
