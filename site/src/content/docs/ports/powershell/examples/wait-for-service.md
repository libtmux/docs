---
port: powershell
route: examples/wait-for-service
title: Wait for a service
description: Wait for an HTTP readiness line and check the service responds.
sidebar:
  label: Wait for a service
  group: Examples
  order: 4
tableOfContents: true
---

Start Python's HTTP server on an available loopback port, wait for
its readiness line, and make an HTTP request. The session is removed on
success or failure, which also stops the HTTP server.

## Setup

PowerShell 7.4.20 with PSResourceGet 1.1.1, Python 3, a POSIX shell,
and tmux on Linux. Start in an empty directory.
The following commands run in a POSIX shell.

Install [LibTmux](https://www.powershellgallery.com/packages/LibTmux/)
from PowerShell Gallery with PSResourceGet. Installation uses your current
user's module directory; the program loads it with `Import-Module LibTmux`.

```console
$ pwsh -NoLogo -NoProfile -Command '
  $ErrorActionPreference = "Stop"
  Install-PSResource -Name LibTmux `
    -Repository PSGallery -Scope CurrentUser -TrustRepository
'
```

## Program

Save this complete program as `wait-for-service.ps1`.

```powershell title="wait-for-service.ps1"
$ErrorActionPreference = 'Stop'
Import-Module LibTmux

$session = $null
$failure = $null
try {
    $socket = 'libtmux-example-' + [Guid]::NewGuid().ToString('N')
    $server = New-TmuxServer -SocketName $socket -ConfigurationFile /dev/null

    $session = $server | New-TmuxSession -Name http `
        -Command 'exec python3 -u -m http.server 0 --bind 127.0.0.1'
    $pane = $session | Get-TmuxPane
    $ready = $pane | Wait-TmuxPaneText `
        -Pattern '^Serving HTTP on 127\.0\.0\.1 port [0-9]+' `
        -CaseSensitive -Timeout 10 -TailLines 4 -Confirm:$false
    if ($ready.Outcome -notin 'PresentAtEntry', 'Matched') {
        throw "HTTP readiness ended with $($ready.Outcome)."
    }
    $tail = $ready.Tail -join "`n"
    $port = [regex]::Match($tail, 'port ([0-9]+)').Groups[1].Value
    $response = Invoke-WebRequest "http://127.0.0.1:$port/" `
        -TimeoutSec 5 -NoProxy
    if ($response.StatusCode -ne 200) {
        throw "HTTP returned $($response.StatusCode)."
    }
    'readiness: observed'
    'HTTP status: {0}' -f $response.StatusCode
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

`Wait-TmuxPaneText` accepts a line already visible when observation starts
(`PresentAtEntry`) or one observed later (`Matched`). Both are valid here.
A matching line only establishes the text condition; `Invoke-WebRequest`
checks that the service actually responds.

The readiness wait has a ten-second limit, and the HTTP request has a
five-second limit. No fixed sleep is needed. The wait closes its control
client; the script separately removes its owned session in `finally`.

## Run

```console
$ unset TMUX TMUX_PANE
$ export ENV=/dev/null BASH_ENV=/dev/null SHELL=/bin/sh
$ pwsh -NoLogo -NoProfile -File wait-for-service.ps1
```

Expected output:

```text
readiness: observed
HTTP status: 200
```

## Related APIs

- [`Wait-TmuxPaneText`](../../reference/libtmux-wait-tmuxpanetext/)
- [Wait for an application's readiness line](../../guides/input/#wait-for-an-applications-readiness-line)
- [`Remove-TmuxSession`](../../reference/libtmux-remove-tmuxsession/)

## Source and verification

This program uses [LibTmux at the package source revision](https://github.com/libtmux/libtmux-powershell/blob/fcd0634e9ca887b70d88915c2d8e26c5da2737e5/README.md).
The verification runner executes these displayed files and setup commands
unchanged, checks the output, and checks that the program stopped its private
tmux server. Each example runs independently.
