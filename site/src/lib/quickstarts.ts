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
 * Excerpts from each port's tested README or examples, at the release the
 * install line pins, with their source and verification notes.
 *
 * Every entry does the same four things: get a session, add a window or pane,
 * send it a command, and read the pane back. The home page shows them in one
 * picker, so a reader switching languages compares the same task.
 *
 * Backslashes in source code need an extra escape inside template literals.
 */
export const QUICKSTARTS: Partial<Record<string, Quickstart>> = {
  py: {
    lang: 'python',
    code: `import libtmux

server = libtmux.Server()
session = server.new_session(session_name="demo")
pane = session.active_window.split(shell="sh")

pane.send_keys('echo "Hello world"', enter=True)
print(pane.capture_pane())`,
    source:
      "Adapted from the new_session, active_window, split, send_keys and capture_pane docstrings in src/libtmux/server.py, session.py and pane.py. pytest runs them as doctests against a real tmux.",
  },
  ts: {
    lang: 'ts',
    code: `import { Server } from "libtmux";

const server = new Server();
const session = await server.newSession({ name: "work" });
const editor = await session.newWindow({ name: "editor" });
await editor.split();

await editor.panes.at(0)?.sendKeys("echo hello");
const lines = await editor.panes.at(0)?.capture();`,
    source:
      "From the README's libtmux section. That block is not run, but examples/quickstart/quickstart.ts runs the same newSession, newWindow, split and sendKeys calls against tmux in the integration suite.",
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

window, err := session.NewWindow(ctx, tmux.NewWindowRequest{Name: new("work")})
if err != nil {
	return fmt.Errorf("create window: %w", err)
}
pane, err := window.SplitPane(ctx, tmux.SplitPaneRequest{
	Direction: tmux.PaneDirectionRight, Command: "sh",
})
if err != nil {
	return fmt.Errorf("split window: %w", err)
}
output, err := pane.OpenObservation(ctx)
if err != nil {
	return fmt.Errorf("watch pane: %w", err)
}
defer func() { err = errors.Join(err, output.Close()) }()
if _, err := fmt.Fprintln(pane.Writer(ctx), "printf 'libtmux ready\\\\n'"); err != nil {
	return fmt.Errorf("send command: %w", err)
}

scanner := bufio.NewScanner(output.Reader(ctx))
for scanner.Scan() {
	if scanner.Text() == "libtmux ready" {
		fmt.Println("libtmux ready")
		return nil
	}
}
return fmt.Errorf("read pane: %w", scanner.Err())`,
    source:
      "From examples/quickstart/main.go: session creation, the docs:quickstart region and the read loop. TestQuickstart runs the whole file against a real tmux server; go generate ./tmux keeps the README copy of the region in sync.",
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

    pane.capture().forEach(System.out::println);
}`,
    source:
      "Adapted from the README opening example, printing the pane with capture() as the README's \"Send keys and read what a pane shows\" section reads it. The docs-tests module runs that section; it compiles the opening snippet but does not run it, because its second client would race the test server.",
    note: "Set `socket` to a `java.nio.file.Path` for your tmux socket. `TmuxEnvironment.current()` resolves the socket your own process is already inside, when there is one.",
  },
  dotnet: {
    lang: 'csharp',
    code: `using LibTmux;
using LibTmux.Testing;

Server server = await Server.ConnectAsync();
Session session = await server.CreateSessionAsync(new NewSessionRequest(name: "build"));
Window window = await session.CreateWindowAsync(new NewWindowRequest(name: "tests"));
Pane pane = (await window.GetPanesAsync())[0];

await pane.SendTextAsync("echo hello-from-libtmux");
await pane.EnterAsync();

// tmux accepts a command before the shell has finished it, so the result is
// waited for rather than assumed.
string output = await TmuxWait.UntilAsync(
    async token => string.Join('\\n', await pane.CaptureAsync(cancellationToken: token)),
    text => text.Contains("hello-from-libtmux", StringComparison.Ordinal),
    TimeSpan.FromSeconds(10),
    TimeSpan.FromMilliseconds(20));`,
    source:
      "Adapted from the README's ConnectAndBuild snippet and its \"Running something, and reading it back\" section, without that section's cancellation token. sync_snippets.py --check checks the first against examples/LibTmux.Examples/Snippets/OneShot.cs; ReadmeExampleTests compiles and runs the second.",
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
const libtmux::Session& session = sessions->at(0);

const auto editor = session.new_window({.name = "editor"});
if (!editor.has_value()) {
  std::fprintf(stderr, "%s\\n", editor.error().diagnostic.c_str());
  return 1;
}

const auto logs = editor->split({.horizontal = true, .percentage = 30});
if (!logs.has_value()) {
  std::fprintf(stderr, "%s\\n", logs.error().diagnostic.c_str());
  return 1;
}

(void)logs->send_text("journalctl -f");
(void)logs->send_key("Enter");

const auto visible = logs->capture();
if (visible.has_value()) {
  std::printf("%zu bytes on screen\\n", visible->size());
}`,
    source:
      "Adapted from the connect, build and capture regions of examples/05-readme.cpp, reading back the pane the build region split. tools/docs/check_readme.py checks the README copy, and CTest builds and runs the whole file.",
    note: "Create `server` with `Server::from_env()` inside tmux, or select a socket with `Server::at_socket_name()`, `Server::at_socket_path()`, or `Server::at_default()`.",
  },
  swift: {
    lang: 'swift',
    code: `import LibTmux

let server = try Server(socketName: "default")

let session = try await server.newSession(named: "work", windowName: "editor")
let logs = try await server.newWindow(in: session, named: "logs").window
let pane = try await server.splitWindow(logs, direction: .right)
try await server.run("tail -f /tmp/build.log", in: pane)

let lines = try await server.capture(pane)
print(lines.suffix(5).joined(separator: "\\n"))`,
    source:
      "From the README's opening and \"Change what is there\" examples, without the session option that section also sets. Examples/Sources/ExampleCode/Changing.swift holds the same calls; swift test --package-path Examples compiles and runs them.",
  },
}
