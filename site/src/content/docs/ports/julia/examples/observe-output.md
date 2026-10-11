---
port: julia
route: examples/observe-output
title: Observe pane output
description: Capture a baseline and verify the bytes of a Unicode terminal echo.
sidebar:
  label: Observe pane output
  group: Examples
  order: 5
tableOfContents: true
---

Observe output from a pane running `/bin/cat`. Capture a baseline, send
literal Unicode text, and assert that the observed bytes match that text.

## Setup

Julia 1.13.0, Git, POSIX shell and tmux on Linux. Start in an empty directory.
The following commands run in a POSIX shell.

Fetch the library revision used by this program.

```console
$ git init -q source
$ git -C source fetch -q --depth=1 \
  https://github.com/libtmux/libtmux-julia.git \
  6f62bd72cb8d99f3759ca5e2cc3591165a03c768
$ git -C source checkout -q --detach FETCH_HEAD
```

## Program

Save this complete program as `output_stream.jl`.

```julia title="output_stream.jl"
using LibTmux

environment = Dict(
    "PATH" => get(ENV, "PATH", "/usr/bin:/bin"),
    "TERM" => "xterm-256color",
    "SHELL" => "/bin/sh",
)

with_server(; tmux=get(ENV, "LIBTMUX_TEST_TMUX", "tmux"), env=environment) do server
    created = new_session(server; name="stream", command=["/bin/cat"])
    pane = only(panes(snapshot(server))).ref
    open_control(server, created) do connection
        observe_output(connection, pane) do stream
            baseline = capture_baseline(stream)
            @assert baseline.continuity === :reset
            message = "observed terminal echo: λ"
            send_keys(server, pane, message; literal=true)
            bytes = UInt8[]
            started = time_ns()
            while length(bytes) < ncodeunits(message)
                remaining = 0.9 - (time_ns() - started) / 1e9
                remaining > 0 || error("terminal echo deadline expired")
                append!(bytes, take!(stream; timeout=remaining).bytes)
            end
            @assert bytes == codeunits(message)
            @assert observation_cursor(stream).pane == pane.id
            println(decode_text(bytes))
        end
    end
end
```

The baseline explicitly reports `:reset`; it is a new observation point.
The loop collects output with a deadline and compares bytes before decoding
them. The text has no newline, so this demonstrates the terminal's echo of
typed input, not completion of a shell command.

Each ownership block closes its resource: output stream, control connection,
then server. A timeout or failed assertion follows the same cleanup path.

## Run

```console
$ unset TMUX TMUX_PANE
$ export ENV=/dev/null BASH_ENV=/dev/null SHELL=/bin/sh
$ julia --startup-file=no --project=source output_stream.jl
```

Expected output:

```text
observed terminal echo: λ
```

## Related APIs

- [`observe_output`](../../reference/libtmux-observe_output/)
- [`capture_baseline`](../../reference/libtmux-capture_baseline/)
- [Observations](../../topics/observations/)

## Source and verification

The complete program comes from [examples/output_stream.jl](https://github.com/libtmux/libtmux-julia/blob/6f62bd72cb8d99f3759ca5e2cc3591165a03c768/examples/output_stream.jl).
The verification runner executes these displayed files and setup commands
unchanged, checks the output, and checks that the program stopped its private
tmux server. Each example runs independently.
