import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * What libtmux-dotnet's two programs (C# and F#) share: the toolchain, the
 * build against the checkout, and the preamble of the tmux commands the
 * library sends.
 *
 * The displayed project says `PackageReference LibTmux [0.1.0]`, so the
 * checkout is packed into a feed of its own and the project is restored from
 * that, offline: `nuget.config` (one level above both copies, so the
 * displayed project file is untouched) maps `LibTmux*` to that feed and every
 * other package to the user's package cache, and the packages folder is the
 * sandbox's, so the published LibTmux 0.1.0 in the cache is never picked up.
 */

/** The framework the programs are built and run for; the project file lists net8.0 too. */
export const FRAMEWORK = 'net10.0'

const toolEnv = (sandbox) => ({
  ...process.env,
  DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1', DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1',
  MSBUILDDISABLENODEREUSE: '1', NUGET_PACKAGES: join(sandbox, 'packages'),
})

const dotnet = (sandbox, args, cwd) => execFileSync('dotnet', args, { cwd, env: toolEnv(sandbox), stdio: ['ignore', 'inherit', 'inherit'] })

const nugetConfig = (sandbox) => `<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <packageSources>
    <clear />
    <add key="checkout" value="${join(sandbox, 'feed')}" />
    <add key="cache" value="${join(homedir(), '.nuget/packages')}" />
  </packageSources>
  <packageSourceMapping>
    <packageSource key="checkout"><package pattern="LibTmux*" /></packageSource>
    <packageSource key="cache"><package pattern="*" /></packageSource>
  </packageSourceMapping>
</configuration>
`

/**
 * Pack the checkout's `projects` into a feed, restore and build the displayed
 * and the marked copy against it. `copies` is `{ exact: { file: text }, marked: { file: text } }`.
 */
export function buildDotnet({ sandbox, checkout, projects, copies }) {
  mkdirSync(join(sandbox, 'feed'), { recursive: true })
  writeFileSync(join(sandbox, 'nuget.config'), nugetConfig(sandbox))
  try {
    for (const project of projects) dotnet(sandbox, ['pack', join(checkout, 'src', project), '-c', 'Release', '-o', join(sandbox, 'feed'), '-p:UseSharedCompilation=false'], checkout)
    for (const [dir, files] of Object.entries(copies)) {
      mkdirSync(join(sandbox, dir), { recursive: true })
      for (const [name, text] of Object.entries(files)) writeFileSync(join(sandbox, dir, name), text)
      dotnet(sandbox, ['restore'], join(sandbox, dir))
      dotnet(sandbox, ['build', '--no-restore', '-c', 'Release', '-f', FRAMEWORK, '-p:UseSharedCompilation=false'], join(sandbox, dir))
    }
  } finally {
    dotnet(sandbox, ['build-server', 'shutdown'], sandbox)
  }
}

/** The program as the page shows it is `app/<file>`; its project and SDK pin are the displayed ones, from the home example. */
export function projectFiles(port, names) {
  const home = JSON.parse(readFileSync(new URL('../../../site/src/data/home-examples.json', import.meta.url), 'utf8'))[port]
  return Object.fromEntries(names.map((name) => [name, home.files.find((entry) => entry.name === `app/${name}`).code]))
}

/**
 * Every libtmux-dotnet command is preceded by its guards: `if-shell -F` checks
 * that fail if the daemon or its version changed (they name `libtmux-version-`
 * or `libtmux_stale_`), and, on its control client, a `display-message` that reads
 * the daemon's pid and start time. After each command it sends a line that is
 * no command (`libtmux-control-<hash>`), which tmux answers with a parse
 * error to mark the end of the reply, and a pane's control client opens with a
 * `%if` block that names the daemon. All of them are dropped, with their replies.
 */
export const dotnetFence = (command) => (command[0] === 'if-shell' && command.some((word) => /^libtmux[-_](version|stale)/.test(word)))
  || (command[0] === 'display-message' && command.includes('#{pid}:#{start_time}'))
  || (command.length === 1 && command[0].startsWith('libtmux-control-'))
  || command[0] === '%if'

/** What the library asks tmux about itself: `tmux -V`, and the `run-shell -C` that expands the daemon's identity. */
export const dotnetProbe = ({ flags, commands }) => (commands.length === 0 && flags.includes('-V'))
  || (commands.length > 0 && commands.every((command) => command[0] === 'run-shell' && command.some((word) => word.startsWith('libtmux-version-'))))

export const toolchain = () => ({ dotnet: execFileSync('dotnet', ['--version'], { encoding: 'utf8', cwd: homedir() }).trim() })

/** Run a built copy with the SDK's own telemetry and banner off. */
export const runCommand = (dir, assembly) => ['env', 'DOTNET_CLI_TELEMETRY_OPTOUT=1', 'DOTNET_NOLOGO=1', 'dotnet', join(dir, 'bin/Release', FRAMEWORK, `${assembly}.dll`)]

