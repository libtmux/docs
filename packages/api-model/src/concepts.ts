/**
 * The same idea, named differently in each port.
 *
 * Eight libraries wrapping one tool do not converge on one vocabulary:
 * Python's `capture_pane` is `capture` almost everywhere else, `Pane.split`
 * in five ports is `Window.split` in C++, and Swift puts on `Server` what the
 * others put on `Pane`. Nothing derivable from the source says these are the
 * same operation, and no amount of name similarity would prove it —
 * `Session.attached` is a property in Java and a verb in others.
 *
 * So this is hand-maintained, deliberately. What keeps it from rotting is
 * `concepts.test.ts`, which resolves every id below against the extracted
 * models: a rename upstream fails the test rather than silently dropping a
 * link.
 *
 * A port that genuinely lacks an operation says so. "No direct equivalent" is
 * a real answer to "how do I do this here", and a better one than an empty
 * cell.
 */
export interface Concept {
  /** What the operation does, in one line, in no particular language. */
  label: string
  /** Public id of the symbol implementing it, per port. */
  symbols: Record<string, string>
  /** Why a port is missing, when it is. */
  absent?: Record<string, string>
}

export const CONCEPTS: Record<string, Concept> = {
  'capture-pane': {
    label: 'Read a pane’s visible contents',
    symbols: {
      py: 'libtmux.Pane.capture_pane',
      ts: 'pane.Pane.capture',
      rs: 'pane.observe.Pane.capture',
      go: 'tmux.Pane.Capture',
      java: 'io.github.libtmux.Pane.Pane.capture',
      dotnet: 'LibTmux.Pane.CaptureAsync',
      cxx: 'libtmux::Pane::capture',
      swift: 'Server.capture(_:since:limit:)',
    },
  },
  'send-keys': {
    label: 'Send keystrokes to a pane',
    symbols: {
      py: 'libtmux.Pane.send_keys',
      ts: 'pane.Pane.sendKeys',
      rs: 'pane.Pane.send_keys',
      go: 'tmux.Pane.SendKeys',
      dotnet: 'LibTmux.Pane.SendKeysAsync',
      cxx: 'libtmux::Pane::send_text',
      swift: 'Server.sendKeys(_:to:literally:)',
    },
    absent: {
      java: 'no direct equivalent; `Pane.paste` writes a buffer instead',
    },
  },
  'split-pane': {
    label: 'Split a pane in two',
    symbols: {
      py: 'libtmux.Pane.split',
      ts: 'pane.Pane.split',
      rs: 'pane.Pane.split',
      go: 'tmux.Pane.Split',
      java: 'io.github.libtmux.Pane.Pane.split',
      dotnet: 'LibTmux.Pane.SplitAsync',
      cxx: 'libtmux::Window::split',
      swift: 'Server.split(_:direction:size:startDirectory:)',
    },
  },
  'new-session': {
    label: 'Create a session',
    symbols: {
      py: 'libtmux.Server.new_session',
      ts: 'server.Server.newSession',
      rs: 'server.Server.new_session',
      go: 'tmux.Server.NewSession',
      java: 'io.github.libtmux.Server.Server.newSession',
      dotnet: 'LibTmux.Server.CreateSessionAsync',
      cxx: 'libtmux::Server::new_session',
      swift: 'Server.newSession(named:startDirectory:windowName:)',
    },
  },
  'new-window': {
    label: 'Create a window',
    symbols: {
      py: 'libtmux.Session.new_window',
      ts: 'session.Session.newWindow',
      rs: 'session.Session.new_window',
      go: 'tmux.Session.NewWindow',
      java: 'io.github.libtmux.Session.Session.newWindow',
      dotnet: 'LibTmux.Session.CreateWindowAsync',
      cxx: 'libtmux::Session::new_window',
      swift: 'Server.newWindow(in:named:startDirectory:)',
    },
  },
  'kill-server': {
    label: 'Shut the tmux server down',
    symbols: {
      py: 'libtmux.Server.kill',
      ts: 'server.Server.kill',
      rs: 'server.Server.kill',
      go: 'tmux.Server.Kill',
      java: 'io.github.libtmux.Server.Server.killServer',
      dotnet: 'LibTmux.Server.KillAsync',
      cxx: 'libtmux::Server::kill',
      swift: 'Server.killServer()',
    },
  },
  'list-sessions': {
    label: 'List the server’s sessions',
    symbols: {
      py: 'libtmux.Server.sessions',
      ts: 'server.Server.sessions',
      rs: 'server.discovery.Server.sessions',
      go: 'tmux.Server.Sessions',
      java: 'io.github.libtmux.Server.Server.sessions',
      dotnet: 'LibTmux.Server.Sessions',
      cxx: 'libtmux::Server::sessions',
      swift: 'Server.sessions()',
    },
  },
  'attach-session': {
    label: 'Attach a client to a session',
    symbols: {
      py: 'libtmux.Session.attach',
      rs: 'control.ControlMode.attach',
      go: 'tmux.Server.AttachSession',
      java: 'io.github.libtmux.control.ControlClient.ControlClient.attach',
      dotnet: 'LibTmux.Server.AttachSessionAsync',
      cxx: 'libtmux::Session::attach_command',
    },
    absent: {
      ts: 'no direct equivalent; the client is out of scope for this port',
      swift: 'reached through `Server.connected(attachingTo:)`, which scopes a block rather than attaching a client',
    },
  },
  'kill-session': {
    label: 'End a session',
    // Swift kills through the server with a target — `Server.kill(_:)` serves session, window and pane alike, where the others put the verb on the object.
    symbols: {
      py: 'libtmux.Session.kill',
      ts: 'session.Session.kill',
      rs: 'session.Session.kill',
      go: 'tmux.Session.Kill',
      java: 'io.github.libtmux.Session.Session.kill',
      dotnet: 'LibTmux.Session.KillAsync',
      cxx: 'libtmux::Session::kill',
      swift: 'Server.kill(_:)',
    },
  },
  'kill-window': {
    label: 'Close a window',
    symbols: {
      py: 'libtmux.Window.kill',
      ts: 'window.Window.kill',
      rs: 'window.Window.kill',
      go: 'tmux.Window.Kill',
      java: 'io.github.libtmux.Window.Window.kill',
      dotnet: 'LibTmux.Window.KillAsync',
      cxx: 'libtmux::Window::kill',
      swift: 'Server.kill(_:)',
    },
  },
  'kill-pane': {
    label: 'Close a pane',
    symbols: {
      py: 'libtmux.Pane.kill',
      ts: 'pane.Pane.kill',
      rs: 'pane.Pane.kill',
      go: 'tmux.Pane.Kill',
      java: 'io.github.libtmux.Pane.Pane.kill',
      dotnet: 'LibTmux.Pane.KillAsync',
      cxx: 'libtmux::Pane::kill',
      swift: 'Server.kill(_:)',
    },
  },
  'rename-session': {
    label: 'Rename a session',
    symbols: {
      py: 'libtmux.Session.rename_session',
      ts: 'session.Session.rename',
      rs: 'session.Session.rename',
      go: 'tmux.Session.Rename',
      java: 'io.github.libtmux.Session.Session.rename',
      dotnet: 'LibTmux.Session.RenameAsync',
      cxx: 'libtmux::Session::rename',
      swift: 'Server.rename(_:to:)',
    },
  },
  'rename-window': {
    label: 'Rename a window',
    symbols: {
      py: 'libtmux.Window.rename_window',
      ts: 'window.Window.rename',
      rs: 'window.Window.rename',
      go: 'tmux.Window.Rename',
      java: 'io.github.libtmux.Window.Window.rename',
      dotnet: 'LibTmux.Window.RenameAsync',
      cxx: 'libtmux::Window::rename',
      swift: 'Server.rename(_:to:)',
    },
  },
  'select-window': {
    label: 'Make a window active',
    symbols: {
      py: 'libtmux.Window.select',
      ts: 'window.Window.select',
      rs: 'window.Window.select',
      go: 'tmux.Window.Select',
      java: 'io.github.libtmux.Window.Window.select',
      dotnet: 'LibTmux.Window.SelectAsync',
      cxx: 'libtmux::Window::select',
      swift: 'Server.select(_:)',
    },
  },
  'select-pane': {
    label: 'Make a pane active',
    symbols: {
      py: 'libtmux.Pane.select',
      ts: 'pane.Pane.select',
      rs: 'pane.Pane.select',
      go: 'tmux.Pane.Select',
      java: 'io.github.libtmux.Pane.Pane.select',
      dotnet: 'LibTmux.Pane.SelectAsync',
      cxx: 'libtmux::Pane::select',
      swift: 'Server.select(_:)',
    },
  },
  'resize-pane': {
    label: 'Resize a pane',
    symbols: {
      py: 'libtmux.Pane.resize',
      ts: 'pane.Pane.resize',
      rs: 'pane.Pane.resize',
      go: 'tmux.Pane.Resize',
      java: 'io.github.libtmux.Pane.Pane.resize',
      dotnet: 'LibTmux.Pane.ResizeAsync',
      swift: 'Server.resize(_:width:height:)',
    },
    absent: {
      cxx: 'no direct equivalent; `libtmux::Window::resize` resizes the window, not a pane within it',
    },
  },
  'list-windows': {
    label: "List a session's windows",
    symbols: {
      py: 'libtmux.Session.windows',
      ts: 'session.Session.windows',
      rs: 'session.Session.windows',
      go: 'tmux.Session.Windows',
      java: 'io.github.libtmux.Session.Session.windows',
      dotnet: 'LibTmux.Session.Windows',
      cxx: 'libtmux::Session::windows',
      swift: 'Server.windows()',
    },
  },
  'list-panes': {
    label: "List a window's panes",
    symbols: {
      py: 'libtmux.Window.panes',
      ts: 'window.Window.panes',
      rs: 'window.navigation.Window.panes',
      go: 'tmux.Window.Panes',
      java: 'io.github.libtmux.Window.Window.panes',
      dotnet: 'LibTmux.Window.Panes',
      cxx: 'libtmux::Window::panes',
      swift: 'Server.panes()',
    },
  },
  'active-window': {
    label: "The session's active window",
    symbols: {
      py: 'libtmux.Session.active_window',
      ts: 'session.Session.activeWindow',
      rs: 'session.Session.active_window',
      go: 'tmux.Session.ActiveWindow',
      java: 'io.github.libtmux.Session.Session.activeWindow',
      dotnet: 'LibTmux.Session.ActiveWindow',
      cxx: 'libtmux::Session::active_window',
    },
    absent: {
      swift: 'no accessor; `Pane.isActive` is a flag on the pane, so the active one is found by filtering a listing',
    },
  },
  'active-pane': {
    label: "The window's active pane",
    symbols: {
      py: 'libtmux.Window.active_pane',
      ts: 'window.Window.activePane',
      rs: 'window.navigation.Window.active_pane',
      go: 'tmux.Window.ActivePane',
      java: 'io.github.libtmux.Window.Window.activePane',
      dotnet: 'LibTmux.Window.ActivePane',
      cxx: 'libtmux::Window::active_pane',
    },
    absent: {
      swift: 'no accessor; `Pane.isActive` is a flag on the pane, so the active one is found by filtering a listing',
    },
  },
  'server-alive': {
    label: 'Whether the server is running',
    symbols: {
      py: 'libtmux.Server.is_alive',
      ts: 'server.Server.isAlive',
      rs: 'server.Server.is_alive',
      go: 'tmux.Server.IsAlive',
      java: 'io.github.libtmux.Server.Server.isAlive',
      dotnet: 'LibTmux.Server.IsAliveAsync',
      cxx: 'libtmux::Server::is_alive',
      swift: 'Server.isRunning()',
    },
  },
}

/** Every concept naming this symbol, for the "in other languages" block. */
export function conceptsFor(port: string, publicId: string): Concept[] {
  return Object.values(CONCEPTS).filter((c) => c.symbols[port] === publicId)
}
