import { execFileSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { statementLines } from '../../../site/src/lib/core-statement.ts'
import { checkoutOf, quickstartSource, withoutMarks } from './common.mjs'

export { withoutMarks }

/**
 * How PowerShell's quickstart is recorded: the calls to mark, what to build,
 * and how the cmdlets' own tmux preamble is recognised (they wrap libtmux-dotnet,
 * so the preamble is the same one).
 *
 * HAND-WRITTEN: `steps` is a person's map from the cmdlets the program calls to
 * their anchors and to a PowerShell expression for the value each returned. It is
 * checked against the program (every anchor must be found once and in the order
 * the marks arrive), not derived from it. A generated map would read the
 * commands from the script's AST (`System.Management.Automation.Language`) and
 * take the value from the variable the statement binds; the recorder would not change.
 */

/**
 * The script the marked copy dot-sources after it imports the module. `Send-DocsMark`
 * runs `LIBTMUX_DOCS_MARK` and stops the program if that fails. The program binds
 * what each call returns to a variable, so a mark reads the value from there and no
 * cmdlet is shadowed.
 */
const POWERSHELL_HELPER = `function Send-DocsMark {
    param([string] $Step, $Value)
    $json = ConvertTo-Json -Compress -Depth 5 -InputObject $Value
    $null = & $env:LIBTMUX_DOCS_MARK $Step $json
    if ($LASTEXITCODE) { [Environment]::Exit($LASTEXITCODE) }
}
`

const HELPER = POWERSHELL_HELPER

/** The mark line, and the line that loads the helper after the module has been imported. */
const mark = (step) => `Send-DocsMark ${JSON.stringify(step.id).replace(/"/g, "'")} (${step.value}) # docs:mark`
const LOAD = '. "$PSScriptRoot/docs_mark.ps1" # docs:mark'

/** Insert a mark after the last line of each step's statement (a line that ends in a backtick or a pipe goes on to the next). */
export function instrumentPowerShell(source, steps) {
  const lines = source.split('\n')
  const inserts = steps.map((step) => {
    const range = statementLines(source, step.anchor, '//', step.occurrence)
    if (!range) throw new Error(`${step.id}: the anchor ${JSON.stringify(step.anchor)} is not on exactly one line of the program`)
    let last = range[1]
    while (/[`|]\s*$/.test(lines[last - 1])) last++
    return { after: last, text: `${/^\s*/.exec(lines[range[0] - 1])[0]}${mark(step)}` }
  })
  const imported = lines.findIndex((line) => line.startsWith('Import-Module '))
  if (imported < 0) throw new Error('the program has no Import-Module line to load the marker helper after')
  inserts.push({ after: imported + 1, text: LOAD })
  for (const { after, text } of inserts.toSorted((a, b) => b.after - a.after)) lines.splice(after, 0, text)
  return lines.join('\n')
}

/** The `pwsh` the programs run, found when they are built. */
const pwsh = {
  /** The version manager's shim fails under the sandbox's home, so the programs run the installed binary itself. */
  get path() {
    const installs = join(homedir(), '.local/share/mise/installs/powershell')
    const version = existsSync(installs) ? readdirSync(installs).filter((name) => existsSync(join(installs, name, 'pwsh'))).sort().at(-1) : undefined
    return version ? join(installs, version, 'pwsh') : 'pwsh'
  },
}

/** The module's `pwsh` and the SDK, with nothing reported anywhere. */
const toolEnv = { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1', MSBUILDDISABLENODEREUSE: '1' }

/**
 * Build the module from the checkout, offline (the package it needs, LibTmux
 * 0.1.0, is restored from the user's package cache), and stage it the way
 * `eng/Build.ps1` does, under `modules/LibTmux/0.1.0` beside the program: the
 * displayed program imports it from there.
 */
function stageModule(checkout, destination) {
  const project = join(checkout, 'src/LibTmux.PowerShell/LibTmux.PowerShell.csproj')
  const binary = join(checkout, 'src/LibTmux.PowerShell/bin/Release/net8.0')
  const dotnet = (...args) => execFileSync('dotnet', args, { cwd: checkout, env: toolEnv, stdio: ['ignore', 'inherit', 'inherit'] })
  try {
    if (!existsSync(join(binary, 'LibTmux.PowerShell.dll'))) {
      dotnet('restore', project, '--source', join(homedir(), '.nuget/packages'), '--locked-mode')
      dotnet('build', project, '-c', 'Release', '--no-restore', '-p:UseSharedCompilation=false')
    }
  } finally {
    dotnet('build-server', 'shutdown')
  }
  rmSync(destination, { recursive: true, force: true })
  mkdirSync(join(destination, 'lib'), { recursive: true })
  cpSync(join(checkout, 'module/LibTmux'), destination, { recursive: true })
  for (const file of ['LibTmux.PowerShell.dll', 'LibTmux.PowerShell.xml', 'libtmux-query-v2.schema.json']) cpSync(join(binary, file), join(destination, file))
  for (const library of ['LibTmux', 'LibTmux.Query.Json', 'Microsoft.Extensions.Logging.Abstractions', 'Microsoft.Extensions.DependencyInjection.Abstractions']) cpSync(join(binary, `${library}.dll`), join(destination, 'lib', `${library}.dll`))
}

/** Every command the library sends is preceded by guards, and followed by a line that is no command (see `dotnet.mjs`). */
const fence = (command) => (command[0] === 'if-shell' && command.some((word) => /^libtmux[-_](version|stale)/.test(word)))
  || (command[0] === 'display-message' && command.includes('#{pid}:#{start_time}'))
  || (command.length === 1 && command[0].startsWith('libtmux-control-'))
  || command[0] === '%if'

const probe = ({ flags, commands }) => (commands.length === 0 && flags.includes('-V'))
  || (commands.length > 0 && commands.every((command) => command[0] === 'run-shell' && command.some((word) => word.startsWith('libtmux-version-'))))

const SERVER = '[ordered]@{ socketName = $server.ConnectionOptions.SocketName; configFile = $server.ConnectionOptions.ConfigurationFile }'
/** A session, window or pane as a recording stores it, from the variable the statement binds. */
const SESSION = (name) => `[ordered]@{ id = "$($${name}.Id)"; name = $${name}.Name }`
const WINDOW = (name) => `[ordered]@{ id = "$($${name}.Id)"; index = $${name}.Index; name = $${name}.Name }`
const PANE = (name) => `[ordered]@{ id = "$($${name}.Id)" }`

export const RECIPES = {
  'typed-graph': {
    capability: 'typed-graph',
    file: 'quickstart.ps1',
    stepMap: 'hand-written',
    /** What a pane runs once it has settled: the default shell, `SHELL=/bin/sh`. */
    paneCommands: ['sh'],
    source: (root) => quickstartSource(root, 'powershell', 'quickstart.ps1'),
    checkout: (port, env, expand) => checkoutOf(port, env, expand),
    helpers: [{ file: 'docs_mark.ps1', source: HELPER }],
    // In the order the calls run. The cmdlets have no rename or select, so those three steps are the native handle's methods.
    // The last four read the snapshot, which holds what tmux said and sends it nothing.
    steps: [
      { id: 'new-server', label: 'New-TmuxServer', anchor: 'New-TmuxServer', type: 'Server', value: SERVER },
      { id: 'new-session', label: 'New-TmuxSession', anchor: 'New-TmuxSession', type: 'Session', value: SESSION('session') },
      { id: 'active-window', label: 'Get-TmuxWindow', anchor: '$session | Get-TmuxWindow', type: 'Window', value: WINDOW('window') },
      { id: 'rename', label: 'Window.RenameAsync', anchor: '.RenameAsync(', type: 'Window', value: WINDOW('editor') },
      { id: 'active-pane', label: 'Get-TmuxPane', anchor: '$editor | Get-TmuxPane', type: 'Pane', value: PANE('left') },
      { id: 'split', label: 'Split-TmuxPane', anchor: 'Split-TmuxPane', type: 'Pane', value: PANE('right') },
      { id: 'new-window', label: 'New-TmuxWindow', anchor: 'New-TmuxWindow', type: 'Window', value: WINDOW('logs') },
      { id: 'send-text', label: 'Send-TmuxText', anchor: 'Send-TmuxText', type: 'void', value: '$null' },
      { id: 'wait', label: 'Wait-TmuxPaneText', anchor: 'Wait-TmuxPaneText', type: 'PaneWaitResult', value: '[ordered]@{ outcome = "$($found.Outcome)"; found = $found.Found }' },
      { id: 'select-pane', label: 'Pane.SelectAsync', anchor: '$right.SelectAsync(', type: 'Pane', value: PANE('right') },
      { id: 'select-window', label: 'Window.SelectAsync', anchor: '$logs.SelectAsync(', type: 'Window', value: WINDOW('logs') },
      { id: 'snapshot', label: 'Get-TmuxSnapshot', anchor: 'Get-TmuxSnapshot', type: 'Snapshot', value: '[ordered]@{ sessions = @($snapshot.Sessions).Count; windows = @($snapshot.Windows).Count; panes = @($snapshot.Panes).Count }' },
      { id: 'pane-lookup', label: 'Snapshot.Panes', anchor: '$snapshot.Panes |', type: 'Pane', value: PANE('pane') },
      { id: 'pane-window', label: 'Pane.Window', anchor: '$pane.Window', type: 'Window', value: WINDOW('window') },
      { id: 'window-session', label: 'Pane.Session', anchor: '$pane.Session', type: 'Session', value: SESSION('owner') },
      { id: 'remove', label: 'Remove-TmuxSession', anchor: 'Remove-TmuxSession', type: 'void', value: '[ordered]@{ errors = @($cleanupErrors).Count }' },
    ],
    fence,
    probe,
    /** The program names its socket `libtmux-home-<process id>`. */
    socket: { pattern: 'libtmux-home-[0-9]+', fixed: 'libtmux-home-12345' },
    instrument: instrumentPowerShell,
    command: (dir) => ['env', 'DOTNET_CLI_TELEMETRY_OPTOUT=1', 'DOTNET_NOLOGO=1', 'POWERSHELL_TELEMETRY_OPTOUT=1', 'POWERSHELL_UPDATECHECK=Off', pwsh.path, '-NoProfile', '-NonInteractive', '-File', join(dir, 'quickstart.ps1')],
    toolchain: () => ({ powershell: execFileSync(pwsh.path, ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.ToString()'], { encoding: 'utf8', cwd: homedir() }).trim() }),
    build({ sandbox, checkout, code, marked, helpers }) {
      for (const [dir, source] of [['exact', code], ['marked', marked]]) {
        mkdirSync(join(sandbox, dir), { recursive: true })
        writeFileSync(join(sandbox, dir, this.file), source)
        stageModule(checkout, join(sandbox, dir, 'modules/LibTmux/0.1.0'))
      }
      for (const helper of helpers) writeFileSync(join(sandbox, 'marked', helper.file), helper.source)
    },
  },
}
