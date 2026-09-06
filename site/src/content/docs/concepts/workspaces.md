---
title: Workspaces
description: Build pane layouts with the object API or a workspace configuration file.
sidebar:
  label: Workspaces
  group: Concepts
  order: 5
tableOfContents: true
---

A workspace arranges windows and panes for a task, such as editing code, running
a development server, and following logs. Build it with the object API when the
layout depends on program logic. Use a declarative builder when you want to
store the layout in a configuration file, such as
[tmuxp](https://tmuxp.git-pull.com/) YAML or JSON.

## Building one imperatively

Create a window, split it into panes, apply a layout, and send each pane its
command:

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

`Window.split()` or `Pane.split()` adds a pane. Direction and size control its
placement. `select_layout()` rearranges the panes while their processes continue
running. tmux provides `even-horizontal`, `even-vertical`, `main-horizontal`,
`main-vertical`, and `tiled` layouts.

Python's `attach=False` and C++'s detached creation keep new windows in the
background. Check the creation defaults for your port if focus matters. Splits
and resizes require tmux commands; [Control mode vs one-shot](../transports/)
covers their transport costs and batching.

## Building one declaratively

These packages read or build workspace configurations based on tmuxp:

| Port | Package | Shape |
|------|---------|-------|
| Python | tmuxp itself | the format this whole idea is named after |
| TypeScript | `@libtmux/workspace` | `applyWorkspace(server, { session_name, windows: [...] })` |
| Go | `workspace` | tmuxp-shaped, per the port's own module layout |
| Rust | `tmux-workspace` | tmuxp-shaped |
| Java | `libtmux-workspace` | "enough of tmuxp's format to describe a workspace" |
| C# | `LibTmux.Workspace` | reads tmuxp YAML directly |
| Swift | `TmuxWorkspace` | Swift, JSON, or YAML (YAML needs the `YAMLWorkspaces` trait) |

TypeScript's `applyWorkspace` applies a desired configuration. Applying the same
configuration again reuses its existing objects:

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

C++ provides a consumer example in `examples/workspace/` that reads tmuxp
configuration. The workspace builder is part of that example, rather than a
library package:

```cpp
// Not a package: this is the examples/workspace/ consumer, showing the
// shape a tmuxp document builds into rather than a library entry point.
const workspace::Workspace description{
    .session_name = "dev",
    .windows = {{.name = "editor", .panes = {{}, {}}}}};
const auto built = workspace::build(server, description);
```

## Cleaning up

For temporary workspaces, Python's `Window` and `Session` context managers kill
their objects on block exit, including when the block raises:

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

See [Context managers](/topics/context-managers/) for cleanup support in each
port. Use explicit kill methods when the handle does not provide scope-based
cleanup.
