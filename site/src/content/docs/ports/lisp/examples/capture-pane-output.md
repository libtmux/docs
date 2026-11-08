---
port: lisp
route: examples/capture-pane-output
title: Capture pane output
description: Run a complete Common Lisp program that captures output on an isolated tmux server.
sidebar:
  label: Capture pane output
  group: Examples
  order: 3
tableOfContents: true
---

This complete Common Lisp program starts a private tmux server, sends one
command, waits for the command's explicit completion signal, and captures the
line it prints. It includes loading, setup, bounded I/O, and cleanup. You need
tmux, mise, and a Unix environment; no existing tmux session is used.

Save both files shown below. Run `sh run.sh` after the [setup](#setup-and-run).

## Read what's on screen

The pane command prints on a fresh row and then signals a tmux `wait-for`
channel on the same private socket. The client waits for that signal with a
five-second command deadline, then captures the pane once. Matching a complete
line avoids accepting the shell's echoed command as output.

```lisp title="capture.lisp"
(require :asdf)

(defparameter *source-root*
  (or (uiop:getenv "LIBTMUX_SOURCE")
      (error "Set LIBTMUX_SOURCE to the libtmux-lisp checkout")))

(asdf:load-asd
 (truename (merge-pathnames "libtmux.asd"
                            (uiop:ensure-directory-pathname *source-root*))))
(asdf:load-system "libtmux")

(defun line-present-p (needle text)
  (with-input-from-string (stream text)
    (loop for line = (read-line stream nil nil)
          while line
          thereis (string= needle line))))

(let ((arguments (uiop:command-line-arguments)))
  (assert (= 2 (length arguments)))
  (destructuring-bind (program socket-path) arguments
    (libtmux:with-client (client :program program
                                 :socket-path socket-path
                                 :config-file "/dev/null"
                                 :timeout 5)
      (let* ((snapshot (libtmux:fetch-snapshot client))
             (pane (aref (libtmux:panes snapshot) 0)))
        (libtmux:send-text
         client pane
         (concatenate
          'string
          "printf '\\nlibtmux capture ready\\n'; "
          "\"$LIBTMUX_PROGRAM\" -N -S \"$LIBTMUX_EXAMPLE_SOCKET\" "
          "wait-for -S capture-ready")
         :enter t)
        (let ((signal (libtmux:run-command
                       client '("wait-for" "capture-ready")
                       :effect :read :timeout 5)))
          (assert (eq :succeeded (libtmux:outcome-status signal))))
        (multiple-value-bind (text outcome)
            (libtmux:capture-pane client pane :start :all)
          (assert (eq :succeeded (libtmux:outcome-status outcome)))
          (assert (line-present-p "libtmux capture ready" text))
          (format t "libtmux capture ready~%"))))))
```

The launcher owns the server. Its exit trap stops that server and removes the
socket directory on normal return, an error, or a signal.

```sh title="run.sh"
#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
source_root=${LIBTMUX_SOURCE:-"$script_dir/libtmux-source"}
binary=$(command -v tmux)
case "$binary" in
    /*) ;;
    *) printf '%s\n' 'tmux must resolve to an absolute path' >&2; exit 1 ;;
esac

mkdir -p /tmp/libtmux-lisp-dev
directory=$(mktemp -d /tmp/libtmux-lisp-dev/capture.XXXXXX)
socket="$directory/tmux.sock"

cleanup() {
    status=$?
    trap - 0 HUP INT TERM
    if [ -S "$socket" ]; then
        if ! "$binary" -N -S "$socket" kill-server; then
            printf 'Could not stop server; retained %s\n' "$directory" >&2
            exit 1
        fi
    fi
    rm -rf "$directory" || exit 1
    exit "$status"
}
trap cleanup 0
trap 'exit 1' HUP INT TERM

env -u TMUX -u TMUX_PANE \
    ENV=/dev/null \
    LIBTMUX_PROGRAM="$binary" \
    LIBTMUX_EXAMPLE_SOCKET="$socket" \
    "$binary" -S "$socket" -f /dev/null \
    new-session -d -s capture /bin/sh

(
    cd "$source_root"
    LIBTMUX_SOURCE="$source_root" mise exec -- sbcl \
        --noinform \
        --disable-debugger \
        --script "$script_dir/capture.lisp" \
        "$binary" \
        "$socket"
)
```

## Completion and ownership

[`libtmux:fetch-snapshot`](../../reference/libtmux-fetch-snapshot/) is the
first external read. [`libtmux:send-text`](../../reference/libtmux-send-text/)
acknowledges input dispatch; it does not claim that the shell ran the command.
The explicit [`libtmux:run-command`](../../reference/libtmux-run-command/)
wait separates command completion from
[`libtmux:capture-pane`](../../reference/libtmux-capture-pane/), which reads
screen state afterward.

[`libtmux:with-client`](../../reference/libtmux-with-client/) closes the
library client but does not kill tmux. The launcher may call `kill-server`
because it created and exclusively owns this private socket. Do not use that
cleanup pattern for a server you merely attached to.

## Setup and run

Use an empty directory and save both displayed files under their shown names.
Clone the exact library revision used to verify the program:

```console
$ git clone https://github.com/libtmux/libtmux-lisp libtmux-source
```

```console
$ git -C libtmux-source checkout 27075ae3e3898fa82f35009460d30fef1ea03826
```

Review the checkout's `mise.toml`, install its pinned SBCL toolchain, and run
the example:

```console
$ cd libtmux-source && mise trust && mise install && cd .. && sh run.sh
```

Success prints `libtmux capture ready` once.

<a id="source-inclusion"></a>

## Where this comes from

The displayed files were loaded and run against the pinned library revision on
Linux with its mise-managed SBCL and an isolated tmux socket. The shared-docs
checks preserve the displayed source bytes and validate every API link.
