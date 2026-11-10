import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { expect, it } from 'vitest'
import HOME from '../src/data/home-examples.json'

// Outer: checks shell cleanup in a separate process.
it('finishes Haskell demo cleanup before returning and preserves the caller trap', () => {
  const root = mkdtempSync(join(tmpdir(), 'haskell-home-scope-'))
  try {
    const bin = join(root, 'bin')
    mkdirSync(bin)
    writeFileSync(join(bin, 'tmux'), `#!/bin/sh
case "$*" in
  *new-session*) : > "$LIBTMUX_TEST_RESOURCE" ;;
  *kill-server*) rm -- "$LIBTMUX_TEST_RESOURCE" ;;
esac
`, { mode: 0o700 })
    writeFileSync(join(bin, 'cabal'), '#!/bin/sh\nexit 0\n', { mode: 0o700 })
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${bin}:${process.env.PATH}`,
      LIBTMUX_TEST_RESOURCE: join(root, 'owned-resource'),
      LIBTMUX_TEST_RESULT: join(root, 'before-return'),
      LIBTMUX_TEST_CALLER_EXIT: join(root, 'caller-exit') }
    delete env.BASH_ENV
    delete env.ENV
    const script = `trap 'printf kept > "$LIBTMUX_TEST_CALLER_EXIT"' EXIT
${HOME.haskell.commands[1]}
if test -e "$LIBTMUX_TEST_RESOURCE"; then
  printf running > "$LIBTMUX_TEST_RESULT"
else
  printf closed > "$LIBTMUX_TEST_RESULT"
fi
`
    const result = spawnSync('bash', ['--noprofile', '--norc', '-eu', '-c', script], {
      env, encoding: 'utf8', timeout: 3_000,
    })
    expect(result.error).toBeUndefined()
    expect(result.status, result.stderr).toBe(0)
    expect(readFileSync(join(root, 'before-return'), 'utf8')).toBe('closed')
    expect(readFileSync(join(root, 'caller-exit'), 'utf8')).toBe('kept')
  } finally { rmSync(root, { recursive: true, force: true }) }
})
