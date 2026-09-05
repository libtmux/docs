---
title: Workspaces
description: Building a multi-pane layout from code, and the tmuxp-shaped declarative builders most ports ship alongside it.
sidebar:
  label: Workspaces
  group: Concepts
  order: 5
tableOfContents: true
---

A workspace is a window carved into panes, each running something specific —
an editor in one, a dev server in another, a log tail in a third. Every
port's object API can build one imperatively: open a window, split it,
arrange the splits, send a command into each pane. Most also ship a
declarative layer on top, shaped after [tmuxp](https://tmuxp.git-pull.com/)'s
YAML/JSON workspace files, for the common case where the layout is
data rather than logic.

## Building one imperatively

The pattern is the same shape everywhere: create a window, split it as many
times as you need panes, apply a layout to tile them evenly, then drive each
pane. Grounded in Python's API (the most fully documented of the eight), a
typical two-pane-plus-logs workspace looks like this:

```python
def create_dev_workspace(session, name='dev'):
    window = session.new_window(window_name=name, attach=False)
    window.resize(height=50, width=160)

    main_pane = window.active_pane
    terminal_pane = main_pane.split(size='30%')
    log_pane = terminal_pane.split(direction=PaneDirection.Right)

    return {'window': window, 'main': main_pane,
            'terminal': terminal_pane, 'logs': log_pane}
```

```rust
let mut window = session.new_window("dev").await?;
let main_pane = window.active_pane().await?.expect("a new window has a pane");

let terminal_pane = main_pane
    .split(SplitOptions::new(SplitDirection::Below).size(PaneSize::Percent(30)))
    .await?;
let logs_pane = terminal_pane
    .split(SplitOptions::new(SplitDirection::Right))
    .await?;

window.select_layout(Layout::MainVertical).await?;
```

```go
window, err := session.NewWindow(ctx, tmux.NewWindowRequest{Name: tmux.Ptr("dev")})
if err != nil {
	return err
}
// Attach: true makes the split active, so the next split divides it rather
// than the pane that was already there.
terminal, err := window.SplitPane(ctx, tmux.SplitPaneRequest{
	Attach: true, Percentage: tmux.Ptr(30),
})
if err != nil {
	return err
}
if _, err := window.SplitPane(ctx, tmux.SplitPaneRequest{Direction: tmux.PaneDirectionRight}); err != nil {
	return err
}
_ = terminal
return window.SelectLayout(ctx, tmux.SelectLayoutRequest{Layout: "main-vertical"})
```

```java
Window window = session.newWindow(w -> w.named("dev").detached());
Pane terminal = window.split(split -> split.percent(30));
Pane logs = terminal.split(split -> split.toRight());

window.selectLayout(Layout.MAIN_VERTICAL);
```

```csharp
Window window = await session.CreateWindowAsync(new NewWindowRequest(name: "dev"));
Pane main = (await window.GetPanesAsync())[0];

Pane terminal = await main.SplitAsync(new SplitPaneRequest(percentage: 30));
Pane logs = await terminal.SplitAsync(new SplitPaneRequest(direction: PaneDirection.Right));

await window.SelectLayoutAsync(new SelectLayoutRequest("main-vertical"));
```

```cpp
const auto window = session.new_window({.name = "dev"});
if (!window.has_value()) return 1;

// `focus = true` makes the new pane active, so the next split divides it.
const auto terminal = window->split({.percentage = 30, .focus = true});
if (!terminal.has_value()) return 1;

const auto logs = window->split({.horizontal = true});
if (!logs.has_value()) return 1;

(void)window->select_layout("main-vertical");
```

```swift
let session = try await server.newSession(named: "work")
let window = try await server.newWindow(in: session, named: "dev").window

let terminal = try await server.splitWindow(window, size: .percentage(30))
let logs = try await server.split(terminal, direction: .right)

try await server.selectLayout(window, "main-vertical")
```

`Window.split()` (or the equivalent `Pane.split()`) is the one method that
turns a single-pane window into a workspace; direction (`PaneDirection.Right`
for side-by-side, the default for stacked) and `size` control the split.
`select_layout()` re-tiles everything afterward without touching what's
running in each pane — tmux ships five built-ins (`even-horizontal`,
`even-vertical`, `main-horizontal`, `main-vertical`, `tiled`), and you can
switch layouts as often as you like.

New windows default to created-in-the-background across the ports that
document the choice explicitly (Python's `attach=False`, C++'s "created
detached: a library call that stole the terminal would be a surprise, and
attaching is a separate decision") — building a workspace shouldn't yank
focus around as each piece comes up. Splitting and resizing are each a
tmux round trip, same as any other mutation; see
[Control mode vs one-shot](../transports/) for what that costs at
scale and how to fold several into one invocation.

## Building one declaratively

Describing a session as data and applying it is common enough that six of
the eight ports ship a purpose-built package for it, each reading (or
authoring) a tmuxp-shaped configuration:

| Port | Package | Shape |
|------|---------|-------|
| Python | tmuxp itself | the format this whole idea is named after |
| TypeScript | `@libtmux/workspace` | `applyWorkspace(server, { session_name, windows: [...] })` |
| Go | `workspace` | tmuxp-shaped, per the port's own module layout |
| Rust | `tmux-workspace` | tmuxp-shaped |
| Java | `libtmux-workspace` | "enough of tmuxp's format to describe a workspace" |
| C# | `LibTmux.Workspace` | reads tmuxp YAML directly |
| Swift | `TmuxWorkspace` | Swift, JSON, or YAML (YAML needs the `YAMLWorkspaces` trait) |

TypeScript's shape is representative of the idea across all of them —
declare the session, apply it, and applying twice converges rather than
duplicating:

```ts
await applyWorkspace(server, {
  session_name: "api",
  windows: [
    { window_name: "editor", panes: ["vim", "git status"] },
    { window_name: "server", panes: [{ shell_command: "bun dev", focus: true }] },
  ],
});
```

```rust
use tmux_workspace::{Workspace, WorkspaceBuilder};

let workspace = Workspace::from_yaml(yaml_source)?;
let session = WorkspaceBuilder::new(&server).build(&workspace).await?;
```

```go
described, err := workspace.Parse(document)
if err != nil {
	return err
}
session, err := workspace.Build(ctx, server, described)
```

```java
Workspace workspace = WorkspaceBuilder.parse(yaml);
Session session = WorkspaceBuilder.build(server, workspace);
```

```csharp
WorkspaceFile workspace = WorkspaceFile.Parse(yaml);
WorkspaceResult result = await new WorkspaceBuilder(server).BuildAsync(workspace, ct);
```

```swift
let workspace = Workspace(
    sessionName: "work",
    windows: [WindowPlan(windowName: "editor", panes: [PanePlan(), PanePlan()])]
)
let session = try await WorkspaceBuilder.build(workspace, on: server)
```

C++ is the exception: rather than shipping its own builder, its README
points straight at tmuxp — "you want a workspace from a config file, tmuxp
already does that, and does it well" — and its `examples/workspace/` is a
worked example of driving tmuxp's format from C++ rather than a package of
its own:

```cpp
// Not a package — this is the examples/workspace/ consumer, showing the
// shape a tmuxp document builds into rather than a library entry point.
const workspace::Workspace description{
    .session_name = "dev",
    .windows = {{.name = "editor", .panes = {{}, {}}}}};
const auto built = workspace::build(server, description);
```

## Cleaning up

A workspace meant to live only for the span of a task — a test run, a
scripted demo — doesn't have to be torn down by hand. Python's `Window` and
`Session` are context managers: the object is created on entry and killed on
exit, including when something inside the `with` block raises, so a workspace
built for one purpose never outlives it as a stray window:

```python
with session.new_window(window_name='temp-window') as temp_win:
    pane = temp_win.active_pane
    pane.send_keys('echo "temporary workspace"')
# window is gone here, even if the block raised
```

```go
// No context manager: defer runs the cleanup at the end of the enclosing
// function instead of the end of a block.
session, err := server.NewSession(ctx, tmux.NewSessionRequest{Name: "temp-session"})
if err != nil {
	return err
}
defer func() {
	cleanupCtx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	err = errors.Join(err, session.Kill(cleanupCtx))
}()
```

```csharp
// The closest match: an owning scope returned alongside the session,
// disposed with `await using` the same way Python's `with` block is.
await using OwnedSessionScope scope = await server.CreateOwnedSessionAsync(
    new NewSessionRequest(name: "temp-session"));
Window window = (await scope.Value.GetWindowsAsync())[0];
Pane pane = (await window.GetPanesAsync())[0];

await pane.SendTextAsync("echo temporary workspace");
// session is gone here, even if an exception unwound through the block
```

Whether another port's window or session handle offers the same
context-manager convenience is worth checking against that port's own
reference rather than assuming — kill methods (`window.kill()`,
`session.kill()`) are the one thing verified across all of them.
