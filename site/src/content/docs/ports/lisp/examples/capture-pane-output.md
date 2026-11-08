---
port: lisp
route: examples/capture-pane-output
title: Capture pane output
description: Run one Common Lisp program that creates, captures, and cleans up an isolated tmux server.
sidebar:
  label: Capture pane output
  group: Examples
  order: 3
tableOfContents: true
---

This standalone Common Lisp program owns its temporary directory, private tmux
server, bounded client operations, and cleanup. It sends one command, waits for
an explicit completion signal, and asserts that the captured screen contains
the complete output line. It needs Linux, SBCL, tmux, and mise.

Save this program, then follow [Setup and run](#setup-and-run).

## Read what's on screen

The pane command prints on a fresh row and signals a tmux `wait-for` channel.
The client waits for that signal with a five-second command deadline, then
captures once. Matching a complete line avoids accepting the echoed command
as output.

```lisp title="capture.lisp"
(require :asdf)
(require :sb-posix)
(asdf:load-asd (truename "libtmux.asd"))
(asdf:load-system "libtmux")

(defun line-present-p (needle text)
  (with-input-from-string (stream text)
    (loop for line = (read-line stream nil nil)
          while line
          thereis (string= needle line))))

(let* ((directory (sb-posix:mkdtemp "/tmp/libtmux-lisp-capture-XXXXXX"))
       (socket (concatenate 'string directory "/tmux.sock"))
       (program (or (uiop:getenv "LIBTMUX_PROGRAM") "tmux"))
       (normal nil)
       (cleanup-ok t))
  (unwind-protect
       (libtmux:with-client (client :program program :socket-path socket
                                    :config-file "/dev/null" :timeout 5)
         (unwind-protect
              (multiple-value-prog1
                  (progn
                    (setf cleanup-ok nil)
                    (libtmux:run-command
                     client
                     (list "new-session" "-d" "-s" "capture"
                           "-e" "ENV=/dev/null"
                           "-e" (concatenate 'string "CAPTURE_TMUX=" program)
                           "-e" (concatenate 'string "CAPTURE_SOCKET=" socket)
                           "/bin/sh")
                     :effect :mutation)
                    (let* ((snapshot (libtmux:fetch-snapshot client))
                           (pane (aref (libtmux:panes snapshot) 0)))
                      (libtmux:send-text
                       client pane
                       (concatenate
                        'string "printf '\\nlibtmux capture ready\\n'; "
                        "\"$CAPTURE_TMUX\" -N -S \"$CAPTURE_SOCKET\" "
                        "wait-for -S capture-ready")
                       :enter t)
                      (libtmux:run-command
                       client '("wait-for" "capture-ready") :effect :read)
                      (multiple-value-bind (text outcome)
                          (libtmux:capture-pane client pane :start :all)
                        (assert (eq :succeeded
                                    (libtmux:outcome-status outcome)))
                        (assert (line-present-p "libtmux capture ready" text))
                        (format t "libtmux capture ready~%"))))
                (setf normal t))
           (when (probe-file socket)
             (handler-case
                 (progn (libtmux:kill-server client) (setf cleanup-ok t))
               (error (condition)
                 (if normal
                     (error condition)
                     (warn "Owned server cleanup failed: ~A" condition)))))))
    (if cleanup-ok
        (uiop:delete-directory-tree
         (uiop:ensure-directory-pathname directory) :validate t)
        (warn "Retained owned fixture directory: ~A" directory))))
```

## Completion and ownership

[`libtmux:run-command`](../../reference/libtmux-run-command/) explicitly starts
the daemon on the new private socket. The high-level
[`libtmux:new-session`](../../reference/libtmux-new-session/) currently
requires an existing daemon, so the example uses the documented argv escape
hatch for this bootstrap step.

[`libtmux:fetch-snapshot`](../../reference/libtmux-fetch-snapshot/) acquires
the graph. [`libtmux:send-text`](../../reference/libtmux-send-text/)
acknowledges input dispatch; the explicit `wait-for` separates shell command
completion from [`libtmux:capture-pane`](../../reference/libtmux-capture-pane/).

[`libtmux:with-client`](../../reference/libtmux-with-client/) closes the
library client. The surrounding `unwind-protect` also calls
[`libtmux:kill-server`](../../reference/libtmux-kill-server/) because this
program created the private server. Cleanup runs on normal return and Lisp
conditions. If server termination fails, the program retains the directory
for inspection and preserves an existing error. Use this termination pattern
only for a server your program owns.

## Setup and run

Use an empty directory and save the displayed program under its shown name.
Clone the exact library revision used to verify it:

```console
$ git clone https://github.com/libtmux/libtmux-lisp libtmux-source
```

```console
$ git -C libtmux-source checkout 0f9da93add247569a184bbda7d1dd1ca986c2e0f
```

Review `mise.toml`, install the pinned toolchain, and run the program from the
checkout. The explicit ASDF load selects the pinned build system rather than
SBCL's bundled version. Core loading needs no external Lisp dependencies.

```console
$ cd libtmux-source && mise trust && mise install && mise exec -- sbcl \
    --noinform \
    --no-sysinit \
    --no-userinit \
    --disable-debugger \
    --load "$(mise where http:asdf-lisp)/asdf.lisp" \
    --script ../capture.lisp
```

Success prints `libtmux capture ready` once. Set `LIBTMUX_PROGRAM` to select
another native tmux executable; it defaults to `tmux` on `PATH`.

<a id="source-inclusion"></a>

## Where this comes from

The displayed program ran against the pinned library on Linux with SBCL
2.6.10, ASDF 3.3.7, and isolated tmux 3.3a and 3.8 servers. Its output assertion
and directory cleanup passed. The shared-docs checks preserve the displayed
source bytes and validate API links.
