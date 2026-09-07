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

/** README excerpts with their source and verification notes.
 * Backslashes in source code need an extra escape inside template literals.
 */
export const QUICKSTARTS: Partial<Record<string, Quickstart>> = {
  py: {
    lang: 'python',
    code: `import libtmux

server = libtmux.Server()
session = server.new_session(session_name="demo")
session.active_pane.send_keys("echo hello from libtmux")`,
    source:
      "Adapted from the README opening and the new_session, active_pane and send_keys docstrings in src/libtmux/server.py, session.py and pane.py.",
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
      "From examples/quickstart/quickstart.ts, with the README connection setup. The integration suite runs the example against tmux; scripts/check-doc-runnable.ts checks the README excerpt.",
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
      "From the crate README. cargo test --doc compiles and runs the block against an isolated tmux server.",
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
      "From examples/quickstart/main.go, including session creation and the docs:quickstart region. go generate ./tmux keeps the README excerpt in sync. Run the full example with go -C examples run ./quickstart.",
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
      "From the README opening example. The docs-tests module compiles this snippet but does not run it because its second client would race the test server.",
    note: "Set `socket` to a `java.nio.file.Path` for your tmux socket. `TmuxEnvironment.current()` resolves the socket your own process is already inside, when there is one.",
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
      "From the README ConnectAndBuild region in examples/LibTmux.Examples/Snippets/. sync_snippets.py --check checks the README copy.",
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
      "From the README quickstart in examples/05-readme.cpp. tools/docs/check_readme.py checks the README copy.",
    note: "Create `server` with `Server::from_env()` inside tmux, or select a socket with `Server::at_socket_name()`, `Server::at_socket_path()`, or `Server::at_default()`.",
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
