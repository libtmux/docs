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
`LIBTMUX_SOCKET_PATH` selects the existing server. The launcher below sets
it to a private socket for trying the example.

```powershell title="connect.ps1"
$ErrorActionPreference = 'Stop'
Import-Module LibTmux -RequiredVersion 0.1.0

$socket = $env:LIBTMUX_SOCKET_PATH
if ([string]::IsNullOrEmpty($socket)) {
    throw 'Set LIBTMUX_SOCKET_PATH to an existing socket.'
}
$server = New-TmuxServer -SocketPath $socket | Connect-TmuxServer
$sessions = @($server | Get-TmuxSession -Name work)
if ($sessions.Count -ne 1) {
    throw 'The work session does not exist.'
}
$sessions[0].Name
```

[`New-TmuxServer`](../../reference/libtmux-new-tmuxserver/) constructs the
endpoint without contacting tmux.
[`Connect-TmuxServer`](../../reference/libtmux-connect-tmuxserver/)
discovers the existing daemon, then
[`Get-TmuxSession`](../../reference/libtmux-get-tmuxsession/) reads sessions
and applies an exact, case-sensitive name selector. An unmatched selector
emits no objects, so the program checks its result explicitly.

The handle borrows the daemon. There is no daemon cleanup in this program:
the caller owns the server and any other sessions on it.

## Setup and run

Use an empty directory on Linux with PowerShell 7.4, POSIX shell, and tmux
installed. Run the following commands in a POSIX shell. Install the
[LibTmux 0.1.0-alpha2 module](https://www.powershellgallery.com/packages/LibTmux/0.1.0-alpha2)
with PSResourceGet:

```console
$ pwsh -NoLogo -NoProfile -Command '
  $ErrorActionPreference = "Stop"
  Install-PSResource -Name LibTmux -Version 0.1.0-alpha2 -Prerelease `
    -Repository PSGallery -Scope CurrentUser -TrustRepository
'
```

Save the launcher as `run.sh`. It starts an isolated tmux server, runs the
program, checks that the session still exists, then stops only that server.
Cleanup runs after failures too. A failed shutdown keeps its socket directory
and prints its location for inspection.

```sh title="run.sh"
#!/bin/sh
set -eu

binary=$(command -v tmux)
directory=$(mktemp -d "${TMPDIR:-/tmp}/libtmux-powershell-attach.XXXXXX")
socket="$directory/tmux.sock"

cleanup() {
    status=$?
    trap - 0 HUP INT TERM
    if [ -S "$socket" ] && ! "$binary" -S "$socket" kill-server; then
        printf 'Cannot stop tmux; kept %s\n' "$directory" >&2
        exit 1
    fi
    rm -rf "$directory" || exit 1
    exit "$status"
}
trap cleanup 0
trap 'exit 1' HUP INT TERM

unset TMUX TMUX_PANE
export LIBTMUX_SOCKET_PATH="$socket" TMUX_BIN="$binary"
"$binary" -S "$socket" -f /dev/null new-session -d -s work /bin/cat
"$@"
"$binary" -S "$socket" has-session -t '=work'
```

```console
$ sh run.sh pwsh -NoLogo -NoProfile -File connect.ps1
```

The program prints `work`. To use your own existing server, set
`LIBTMUX_SOCKET_PATH` to its socket and run the program without the launcher.
The launcher owns only the demonstration server.

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
