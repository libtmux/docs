---
port: lisp
route: guides/attaching-to-tmux
title: Attaching to tmux
description: Connect to an existing tmux server and find a captured session with Common Lisp.
sidebar:
  label: Attaching to tmux
  group: Guides
  order: 2
tableOfContents: true
---

Connect a [`libtmux:client`](../../reference/libtmux-client/) to an explicit
socket, capture the server, and find its `work` session. The program prints the
session name and leaves the tmux server running. A missing server or session is
an error.

This controls tmux from Common Lisp. To open the session in your terminal, use
`tmux attach-session`; the [shared guide](../../../../tmux/guides/attaching-to-tmux/)
covers interactive attachment and detaching.

## Connect to an existing server

Save this program under the filename shown below. `LIBTMUX_SOCKET_PATH` selects
the existing server; `LIBTMUX_SOURCE` points at the checked-out library source.

```lisp title="connect.lisp"
(require :asdf)

(defparameter *source-root* (uiop:getenv-absolute-directory "LIBTMUX_SOURCE"))
(defparameter *socket-path*
  (or (uiop:getenv "LIBTMUX_SOCKET_PATH")
      (error "Set LIBTMUX_SOCKET_PATH to an existing tmux socket")))

(asdf:load-asd (merge-pathnames "libtmux.asd" *source-root*))
(asdf:load-system "libtmux")

(libtmux:with-client (client :socket-path *socket-path*)
  (let* ((snapshot (libtmux:fetch-snapshot client))
         (session (find "work" (libtmux:sessions snapshot)
                        :key #'libtmux:name :test #'string=)))
    (unless session
      (error "The work session does not exist"))
    (format t "~A~%" (libtmux:name session))))
```

[`libtmux:fetch-snapshot`](../../reference/libtmux-fetch-snapshot/) is the one
external read. [`libtmux:sessions`](../../reference/libtmux-sessions/) and the
`find` call traverse captured state locally. Closing the client releases its
process resources; it does not terminate the tmux server.

## Run against an isolated server

Use Linux, Git, SBCL 2.6.10 and tmux 3.3a or newer. Save this launcher under
the filename shown below. It starts an isolated server, runs the Lisp program,
proves the session still exists, and then removes only the server it created.

```sh title="run.sh"
#!/bin/sh
set -eu

binary=$(command -v tmux)
directory=$(mktemp -d "${TMPDIR:-/tmp}/libtmux-lisp-attach.XXXXXX")
socket="$directory/tmux.sock"

cleanup() {
    status=$?
    trap - 0 HUP INT TERM
    if [ -S "$socket" ]; then
        "$binary" -S "$socket" kill-server || status=1
    fi
    rm -rf "$directory" || status=1
    exit "$status"
}
trap cleanup 0
trap 'exit 1' HUP INT TERM

unset TMUX TMUX_PANE
export LIBTMUX_SOURCE="$PWD/libtmux-source"
export LIBTMUX_SOCKET_PATH="$socket"
"$binary" -S "$socket" -f /dev/null new-session -d -s work /bin/cat
"$@"
"$binary" -S "$socket" has-session -t '=work'
```

Fetch the exact library revision used by this page, install its pinned toolchain,
and run the program:

```console
$ git clone https://github.com/libtmux/libtmux-lisp.git libtmux-source &&
  git -C libtmux-source checkout 27075ae3e3898fa82f35009460d30fef1ea03826 &&
  mise -C libtmux-source trust &&
  mise -C libtmux-source install &&
  sh run.sh mise -C libtmux-source exec -- sbcl --script "$PWD/connect.lisp"
```

The program prints `work`. To inspect your own server, set
`LIBTMUX_SOCKET_PATH` and `LIBTMUX_SOURCE`, then run the SBCL command without
the launcher. The caller remains responsible for that server's lifetime.

## Find or create

Reading a session does not reserve its name. If an application creates a
session after an unsuccessful lookup, another client may create the same name
between those operations. Handle the creation failure instead of assuming the
lookup reserved the name.

Continue with the [REPL tutorial](../tutorial/) to traverse the complete
session, window-link, window, and pane graph.
