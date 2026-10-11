---
port: powershell
route: examples/command-completion
title: Check command completion
description: Run a shell command and verify its authenticated nonzero exit status.
sidebar:
  label: Check command completion
  group: Examples
  order: 3
tableOfContents: true
---

Run `exit 7` inside a disposable shell pane and verify its result.
The program waits for the command's authenticated completion status, then
removes the session. It does not infer success from text in a terminal.

## Setup

PowerShell 7.4.20 with PSResourceGet 1.1.1, POSIX shell and tmux on Linux. Start in an empty directory.
The following commands run in a POSIX shell.

Install [LibTmux](https://www.powershellgallery.com/packages/LibTmux/)
from PowerShell Gallery with PSResourceGet. The prerelease flag includes the
alpha releases. Installation uses your current user's module directory;
the program loads it with `Import-Module LibTmux`.

```console
$ pwsh -NoLogo -NoProfile -Command '
  $ErrorActionPreference = "Stop"
  Install-PSResource -Name LibTmux -Prerelease `
    -Repository PSGallery -Scope CurrentUser -TrustRepository
'
```

## Program

Save this complete program as `command-completion.ps1`.

```powershell title="command-completion.ps1"
$ErrorActionPreference = 'Stop'
Import-Module LibTmux

$session = $null
$failure = $null
try {
    $socket = 'libtmux-example-' + [Guid]::NewGuid().ToString('N')
    $server = New-TmuxServer -SocketName $socket -ConfigurationFile /dev/null

    $session = $server | New-TmuxSession `
        -Name command -Command 'exec /bin/sh'
    $pane = $session | Get-TmuxPane
    $result = $pane | Invoke-TmuxPaneCommand `
        -Command 'exit 7' -Timeout 5 -Confirm:$false
    if ($result.TimedOut -or $result.ExitStatus -ne 7) {
        throw 'The shell command did not complete with exit status 7.'
    }
    'exit status: {0}' -f $result.ExitStatus
} catch {
    $failure = [InvalidOperationException]::new(
        "tmux example failed: $($_.Exception.Message)", $_.Exception)
    throw $failure
} finally {
    if ($session) {
        $cleanupErrors = @()
        $session | Remove-TmuxSession -Confirm:$false `
            -ErrorAction SilentlyContinue -ErrorVariable cleanupErrors
        if ($cleanupErrors) {
            if ($failure) {
                $errors = @($failure) + $cleanupErrors.Exception
                throw [AggregateException]::new(
                    'tmux operation and cleanup failed.',
                    [Exception[]]$errors)
            }
            throw $cleanupErrors[0]
        }
    }
}
```

`Invoke-TmuxPaneCommand` runs the command in a subshell. A nonzero exit
status is a result, so this example checks `ExitStatus` explicitly.
[`TimedOut`](/csharp/latest/reference/libtmux-panerunresult-timedout/)
means the command may still be running; the script treats that as
failure and still cleans up its owned session.

This example changes only the private server it creates. The `finally` block
retains cleanup errors, including when the command operation also fails.

## Run

```console
$ unset TMUX TMUX_PANE
$ export ENV=/dev/null BASH_ENV=/dev/null SHELL=/bin/sh
$ pwsh -NoLogo -NoProfile -File command-completion.ps1
```

Expected output:

```text
exit status: 7
```

## Related APIs

- [`Invoke-TmuxPaneCommand`](../../reference/libtmux-invoke-tmuxpanecommand/)
- [Send input to a pane](../../guides/input/)
- [`Remove-TmuxSession`](../../reference/libtmux-remove-tmuxsession/)

## Source and verification

This program uses [LibTmux at the package source revision](https://github.com/libtmux/libtmux-powershell/blob/fcd0634e9ca887b70d88915c2d8e26c5da2737e5/README.md).
The verification runner executes these displayed files and setup commands
unchanged, checks the output, and checks that the program stopped its private
tmux server. Each example runs independently.
