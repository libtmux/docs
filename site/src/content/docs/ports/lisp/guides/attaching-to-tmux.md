---
port: lisp
route: guides/attaching-to-tmux
title: Attaching to tmux
description: Inspect an existing tmux server from a standalone Common Lisp program, with an owned demo fixture.
sidebar:
  label: Attaching to tmux
  group: Guides
  order: 2
tableOfContents: true
---

Connect a [`libtmux:client`](../../reference/libtmux-client/) to an explicit
socket, acquire a snapshot, and find the `work` session. Closing that client
leaves the borrowed server running. A missing server or session is an error.

This controls tmux from Common Lisp. To open a terminal session, use
`tmux attach-session`; the [shared guide](../../../../tmux/guides/attaching-to-tmux/)
covers interactive attachment and detaching.

## Connect to an existing server

Save the program below. With `LIBTMUX_SOCKET_PATH` set, it inspects that server
without owning its lifetime. With the variable unset, it creates a private
server, proves the inspection left it alive, and then removes its own fixture.
Both paths run from the library checkout using its pinned SBCL and ASDF.

```lisp title="connect.lisp"
(require :asdf)
(require :sb-posix)
(asdf:load-asd (truename "libtmux.asd"))
(asdf:load-system "libtmux")

(defparameter *program* (or (uiop:getenv "LIBTMUX_PROGRAM") "tmux"))

(defun inspect-work (socket)
  "Print the captured work session and leave the borrowed server running."
  (libtmux:with-client (client :program *program* :socket-path socket
                               :timeout 5)
    (let* ((snapshot (libtmux:fetch-snapshot client))
           (session (find "work" (libtmux:sessions snapshot)
                          :key #'libtmux:name :test #'string=)))
      (unless session
        (error "The work session does not exist"))
      (format t "~A~%" (libtmux:name session)))))

(defun run-demo ()
  "Own a private fixture; prove inspection does not terminate its server."
  (let* ((directory (sb-posix:mkdtemp "/tmp/libtmux-lisp-attach-XXXXXX"))
         (socket (concatenate 'string directory "/tmux.sock"))
         (normal nil)
         (cleanup-ok t))
    (unwind-protect
         (libtmux:with-client (owner :program *program* :socket-path socket
                                     :config-file "/dev/null" :timeout 5)
           (unwind-protect
                (multiple-value-prog1
                    (progn
                      (setf cleanup-ok nil)
                      (libtmux:run-command
                       owner '("new-session" "-d" "-s" "work" "/bin/cat")
                       :effect :mutation)
                      (inspect-work socket)
                      (libtmux:run-command
                       owner '("has-session" "-t" "=work") :effect :read))
                  (setf normal t))
             (when (probe-file socket)
               (handler-case
                   (progn (libtmux:kill-server owner) (setf cleanup-ok t))
                 (error (condition)
                   (if normal
                       (error condition)
                       (warn "Owned server cleanup failed: ~A" condition)))))))
      (if cleanup-ok
          (uiop:delete-directory-tree
           (uiop:ensure-directory-pathname directory) :validate t)
          (warn "Retained owned fixture directory: ~A" directory)))))

(let ((socket (uiop:getenv "LIBTMUX_SOCKET_PATH")))
  (if socket (inspect-work socket) (run-demo)))
```

[`libtmux:fetch-snapshot`](../../reference/libtmux-fetch-snapshot/) acquires
the graph. [`libtmux:sessions`](../../reference/libtmux-sessions/) and `find`
work on captured state locally. The client scope releases process resources;
it does not terminate tmux.

The demo explicitly bootstraps its owned server through
[`libtmux:run-command`](../../reference/libtmux-run-command/). The high-level
[`libtmux:new-session`](../../reference/libtmux-new-session/) currently
requires a live daemon. Only the demo's owner calls
[`libtmux:kill-server`](../../reference/libtmux-kill-server/). Its cleanup runs
on normal return and Lisp conditions; failed termination retains the fixture
directory and preserves an existing error.

## Setup and run

Use Linux, Git, mise, and tmux 3.3a or newer. Save the displayed program under
its shown filename, then fetch the tested source revision:

```console
$ git clone https://github.com/libtmux/libtmux-lisp libtmux-source
```

```console
$ git -C libtmux-source checkout 0f9da93add247569a184bbda7d1dd1ca986c2e0f
```

Review `mise.toml`, install its pinned toolchain, and run the private demo:

```console
$ cd libtmux-source && mise trust && mise install && \
    env -u LIBTMUX_SOCKET_PATH mise exec -- sbcl \
    --noinform \
    --no-sysinit \
    --no-userinit \
    --disable-debugger \
    --load "$(mise where http:asdf-lisp)/asdf.lisp" \
    --script ../connect.lisp
```

Success prints `work`. The demo verifies that the inspection leaves its server
alive before the owning scope terminates it and removes the directory.
The demo command clears `LIBTMUX_SOCKET_PATH` to ensure fixture isolation.
To inspect your own server, set that variable to its absolute socket path
and repeat the SBCL invocation without `env -u`. That path performs no creation or
termination. Set `LIBTMUX_PROGRAM` to select another native tmux executable.

## Find or create

Reading a session does not reserve its name. Another client can create that
name between a lookup and a creation request. Handle the operation's outcome
instead of assuming the lookup reserved the name.

Continue with the [REPL tutorial](../tutorial/) to traverse the complete
session, window-link, window, and pane graph.

## Verification

The exact displayed program and setup ran against the pinned library on Linux
with SBCL 2.6.10 and ASDF 3.3.7. Isolated tmux 3.3a and 3.8 runs printed `work`,
proved that the borrowed connection left its server alive, and cleaned up the
owned fixture. The shared-docs checks bind the displayed bytes to these runs.
