/**
 * The per-port quickstart snippets, shared by the site home and each port
 * page.
 *
 * Lifted out of `pages/[port]/index.astro` when the home page's language
 * picker started driving the example as well as the install line. One copy,
 * because eight snippets transcribed twice is eight chances for the two
 * pages to disagree about what a port's opening example is.
 */
export interface Quickstart {
  /** Shiki language id for the block. */
  lang: string
  code: string
  /** Where the snippet was taken from, so a reader can check it. */
  source: string
  note?: string
}

/**
 * One quickstart per port, each taken from that port's own README (or, for
 * Go and TypeScript, composed from the README's own opening lines plus the
 * exact file the README itself quotes — see each `source` note below).
 * Nothing here is invented: every line traces to a real file, checked out
 * at the paths this repo's other agents read from.
 *
 * Two escaping traps for anyone editing these strings: they are JS template
 * literals, so a backtick must be `` \` `` and a source file's own
 * backslash (Go's `\\n`, C++'s `\n`) needs one extra backslash to survive —
 * verify with a build, not by eye.
 */
export const QUICKSTARTS: Partial<Record<string, Quickstart>> = {
  py: {
    lang: 'python',
    code: `import libtmux

server = libtmux.Server()
session = server.new_session(session_name="demo")
session.active_pane.send_keys("echo hello from libtmux")`,
    source:
      "The shape follows the README's Server() opening; new_session, active_pane and send_keys are verified against src/libtmux/server.py, session.py and pane.py, not quoted verbatim from one block.",
  },
  ts: {
    lang: 'ts',
    code: `import { Server } from "libtmux";

const server = new Server();

const session = await server.newSession({ name: "quickstart" });
const editor = await session.newWindow({ name: "editor" });
await editor.split();

const snapshot = await server.snapshot();
const found = snapshot.windows.where({ name: "editor" }).one();

const paneCount = found.panes.length;`,
    source:
      "The README's opening `new Server()` line, followed by examples/quickstart/quickstart.ts — run against real tmux by the integration suite and quoted into the README verbatim under a checked <!-- runs: --> marker.",
  },
  rs: {
    lang: 'rust',
    code: `use libtmux::test::TestServer;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Runs for real. \`TestServer\` is an isolated tmux on its own socket under
    // \`/tmp/libtmux-rs-test/\`, torn down at the end. Your own code says
    // \`let server = libtmux::Server::new()?;\` instead; nothing else changes.
    let guard = TestServer::new().await?;
    let server = guard.server();

    let session = server.new_session("work").await?;
    let window = session.new_window("editor").await?;
    let pane = window.active_pane().await?.expect("a window has a pane");

    pane.send_line("echo hello").await?;

    for line in pane.capture().await? {
        println!("{}", line.to_string_lossy());
    }

    guard.shutdown().await?;
    Ok(())
}`,
    source:
      "The crate README's own \"Drive tmux\" section, verbatim — doctested in full via #![doc = include_str!(\"../README.md\")], so `cargo test --doc` compiles and runs this exact block against a throwaway tmux.",
  },
  go: {
    lang: 'go',
    code: `session, err := server.NewSession(ctx, tmux.NewSessionRequest{
	Name: "libtmux-go-quickstart", WindowName: "start",
})
if err != nil {
	return fmt.Errorf("create session: %w", err)
}

windowName := "work"
window, err := session.NewWindow(ctx, tmux.NewWindowRequest{Name: &windowName})
if err != nil {
	return fmt.Errorf("create window: %w", err)
}
pane, err := window.SplitPane(ctx, tmux.SplitPaneRequest{
	Direction: tmux.PaneDirectionRight,
})
if err != nil {
	return fmt.Errorf("split window: %w", err)
}
command := "printf 'libtmux ready\\\\n'"
if err := pane.SendKeys(ctx, tmux.SendKeysRequest{Command: &command, Literal: true}); err != nil {
	return fmt.Errorf("send command: %w", err)
}`,
    source:
      "The session creation from examples/quickstart/main.go, prepended to the README's own <!-- docs:quickstart --> region from the same file — go generate ./tmux regenerates that region from the file and CI fails if they disagree. Runnable as-is: go -C examples run ./quickstart.",
  },
  java: {
    lang: 'java',
    code: `ServerConfig config = ServerConfig.builder()
        .endpoint(ServerEndpoint.socketPath(socket))
        .build();

try (Server server = Server.open(config)) {
    Session session = server.newSession("demo");
    Window window = session.newWindow("build");
    Pane pane = window.split();

    pane.sendLine("echo hello from libtmux");
}`,
    source:
      "The README's opening example, verbatim — checked by docs-tests, which compiles every README snippet and runs it against a real tmux unless the snippet's own <!-- snippet: compile-only: ... --> marker says why not. This one is marked compile-only: it opens a second client to the suite's own server, which would race it.",
    note: "socket in the code above is a `java.nio.file.Path` to a real tmux socket — the README's own test fixture supplies one. `TmuxEnvironment.current()` resolves the socket your own process is already inside, when there is one.",
  },
  dotnet: {
    lang: 'csharp',
    code: `using LibTmux;

Server server = await Server.ConnectAsync();
Session session = await server.CreateSessionAsync(new NewSessionRequest(name: "build"));
Window window = await session.CreateWindowAsync(new NewWindowRequest(name: "tests"));
Pane pane = (await window.GetPanesAsync())[0];

await pane.SendTextAsync("dotnet test");`,
    source:
      "The README's ConnectAndBuild snippet region, published from a real [Example] method under examples/LibTmux.Examples/Snippets/ and kept in sync by sync_snippets.py --check, which CI runs.",
  },
  cxx: {
    lang: 'cpp',
    code: `// No tmux failure is thrown. Every call answers with a value that is either
// the result or the reason there isn't one.
const auto sessions = server.sessions();
if (!sessions.has_value()) {
  std::fprintf(stderr, "%s\\n", sessions.error().diagnostic.c_str());
  return 1;
}

for (const libtmux::Session& session : *sessions) {
  std::printf("%s has %lld window(s)\\n", std::string{session.name()}.c_str(),
              session.window_count());
}`,
    source:
      "The README's Quickstart, \"Connect and look around\" — lives in examples/05-readme.cpp, and tools/docs/check_readme.py fails the build if the two ever disagree.",
    note: "server in the code above comes from `Server::from_env()` (inside tmux), `Server::at_socket_name()`, `Server::at_socket_path()`, or `Server::at_default()` — the README's own words for how to get one.",
  },
  swift: {
    lang: 'swift',
    code: `import LibTmux

let server = try Server(socketName: "default")
for session in try await server.sessions() {
    print(session.name, session.windowCount)
}`,
    source: "The README's opening example, with tmux already running on its default socket.",
  },
}
