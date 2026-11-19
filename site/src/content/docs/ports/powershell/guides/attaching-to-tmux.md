---
port: powershell
route: guides/attaching-to-tmux
title: Attaching to tmux
description: Connect to an existing tmux server and find a session with PowerShell.
sidebar:
  label: Attaching to tmux
  group: Guides
  order: 3
tableOfContents: true
---

Connect to an explicit socket, read the existing `work` session, and print
its name. The program leaves the server running. A missing server or session
ends the script with an error.

This controls tmux from PowerShell. To open a session in your terminal, use
`tmux attach-session`; the [shared guide](../../../../tmux/guides/attaching-to-tmux/)
covers interactive attachment and detaching.

<a id="which-socket-a-bare-constructor-reaches"></a>

## Connect to an existing server

Save the complete program as `connect.ps1`. The environment variable
`LIBTMUX_SOCKET_PATH` selects the existing server, and `$showWork`
connects to it and prints `work`. Without the variable, the program creates a
private socket path in a new temporary directory and passes it to
[`New-TmuxServer`](../../reference/libtmux-new-tmuxserver/) with an empty
configuration. [`New-TmuxSession`](../../reference/libtmux-new-tmuxsession/)
starts that server with a detached `work` session running `cat`, and
`$showWork` reaches it through a second endpoint handle. The `finally`
block stops the private server with
[`Invoke-TmuxCommand`](../../reference/libtmux-invoke-tmuxcommand/) and removes
the directory after success or failure. If the server does not stop, the
script reports the error and keeps the directory.

```powershell title="connect.ps1"
$ErrorActionPreference = 'Stop'
Import-Module LibTmux -RequiredVersion 0.1.0

$showWork = {
    param([string]$Socket)
    $server = New-TmuxServer -SocketPath $Socket | Connect-TmuxServer
    $sessions = @($server | Get-TmuxSession -Name work)
    if ($sessions.Count -ne 1) {
        throw 'The work session does not exist.'
    }
    $sessions[0].Name
}

if ($env:LIBTMUX_SOCKET_PATH) {
    & $showWork $env:LIBTMUX_SOCKET_PATH
    return
}

# No server was named: start one this program owns, in a new directory.
$directory = Join-Path ([IO.Path]::GetTempPath()) `
    ('libtmux-attach-' + [Guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $directory
$socket = Join-Path $directory tmux.sock
$owner = New-TmuxServer -SocketPath $socket -ConfigurationFile /dev/null
try {
    $null = $owner | New-TmuxSession -Name work -Command 'exec /bin/cat'
    & $showWork $socket
} finally {
    if (Test-Path $socket) {
        try {
            $null = $owner | Invoke-TmuxCommand -Arguments 'kill-server'
        } catch {
            throw "Cannot stop tmux; kept ${directory}: $($_.Exception.Message)"
        }
    }
    Remove-Item -Recurse -Force $directory
}
```

[`New-TmuxServer`](../../reference/libtmux-new-tmuxserver/) constructs the
endpoint without contacting tmux.
[`Connect-TmuxServer`](../../reference/libtmux-connect-tmuxserver/)
discovers the existing daemon, then
[`Get-TmuxSession`](../../reference/libtmux-get-tmuxsession/) reads sessions
and applies an exact, case-sensitive name selector. An unmatched selector
emits no objects, so the program checks its result explicitly.

The handle in `$showWork` borrows the daemon. It runs no daemon cleanup:
the caller owns the server and any other sessions on it.

## Setup and run

Use an empty directory on Linux with PowerShell 7.4, POSIX shell, and tmux
installed. Run the following commands in a POSIX shell. Install the
[LibTmux 0.1.0 module](https://www.powershellgallery.com/packages/LibTmux/0.1.0)
with PSResourceGet:

```console
$ pwsh -NoLogo -NoProfile -Command '
  $ErrorActionPreference = "Stop"
  Install-PSResource -Name LibTmux -Version 0.1.0 `
    -Repository PSGallery -Scope CurrentUser -TrustRepository
'
```

Run the program:

```console
$ pwsh -NoLogo -NoProfile -File connect.ps1
```

The program prints `work`. To use your own existing server, set
`LIBTMUX_SOCKET_PATH` to its socket before running the program; it prints
`work` and leaves that server running.

<a id="finding-a-session-instead-of-always-creating-one"></a>

## Find or create a session

Reading a session does not reserve its name. If your application creates a
session after an unsuccessful lookup, another client may create the same name
between those operations. Handle the creation error as well as the lookup.

[Read tmux objects](../read/) explains captured values and selectors.
[Create windows and panes](../../examples/create-layout/) is a complete
program that creates and cleans up its own session.

The module's [package source revision](https://github.com/libtmux/libtmux-powershell/tree/fcd0634e9ca887b70d88915c2d8e26c5da2737e5)
records the implementation used by this example.
