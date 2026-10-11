---
port: powershell
route: examples/create-layout
title: Create windows and panes
description: Create a session with two windows, then query a captured snapshot.
sidebar:
  label: Create windows and panes
  group: Examples
  order: 2
tableOfContents: true
---

Create an isolated tmux server with an editor window containing two
panes and a separate logs window. Read their names and pane IDs from one
captured snapshot, then remove the session and stop its server.

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

Save this complete program as `quickstart.ps1`.

```powershell title="quickstart.ps1"
$ErrorActionPreference = 'Stop'
Import-Module LibTmux

$session = $null
$failure = $null
try {
    $socket = 'libtmux-home-' + [Guid]::NewGuid().ToString('N')
    $server = New-TmuxServer -SocketName $socket -ConfigurationFile /dev/null

    $session = $server | New-TmuxSession `
        -Name demo -WindowName editor -Command 'exec /bin/cat'
    $pane = $session | Get-TmuxPane
    $null = $pane | Split-TmuxPane -Horizontal -Command 'exec /bin/cat'
    $null = $session | New-TmuxWindow -Name logs -Command 'exec /bin/cat'

    $captured = ($server | Get-TmuxSnapshot).Sessions |
        Select-TmuxSession -Criteria @{ Name = 'demo' } -ExactlyOne
    foreach ($window in $captured.Windows) {
        '{0}: {1}' -f $window.Name, ($window.Panes.Id -join ', ')
    }
} catch {
    $failure = [InvalidOperationException]::new(
        "tmux quickstart failed: $($_.Exception.Message)", $_.Exception)
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

The private socket name is unique to this run. `-ConfigurationFile /dev/null`
keeps personal tmux configuration out of the example. Each pane runs `/bin/cat`
so it stays alive without a shell prompt or startup commands.

`-ExactlyOne` rejects missing or ambiguous session matches. The `finally` block
removes the only session; tmux then exits. If an operation and cleanup both
fail, the script preserves both errors.

## Run

```console
$ unset TMUX TMUX_PANE
$ export ENV=/dev/null BASH_ENV=/dev/null SHELL=/bin/sh
$ pwsh -NoLogo -NoProfile -File quickstart.ps1
```

Expected output:

```text
editor: %0, %1
logs: %2
```

## Related APIs

- [`New-TmuxSession`](../../reference/libtmux-new-tmuxsession/)
- [`Split-TmuxPane`](../../reference/libtmux-split-tmuxpane/)
- [`Get-TmuxSnapshot`](../../reference/libtmux-get-tmuxsnapshot/)
- [`Select-TmuxSession`](../../reference/libtmux-select-tmuxsession/)
- [`Remove-TmuxSession`](../../reference/libtmux-remove-tmuxsession/)

## Source and verification

This program uses [LibTmux at the package source revision](https://github.com/libtmux/libtmux-powershell/blob/fcd0634e9ca887b70d88915c2d8e26c5da2737e5/README.md).
The verification runner executes these displayed files and setup commands
unchanged, checks the output, and checks that the program stopped its private
tmux server. Each example runs independently.
