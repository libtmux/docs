---
title: "Workspace environment"
description: "Tmuxp workspace environment."
product: workspace
sidebar:
  group: Configuration
  label: "Environment"
  order: 35
tableOfContents: true
ports:
  py:
    description: "Tmuxp workspace environment, field meanings, defaults, and execution behavior."
  ts:
    description: "Tmuxp workspace environment and current TypeScript builder compatibility."
  rs:
    description: "Tmuxp workspace environment and current Rust builder compatibility."
  go:
    description: "Tmuxp workspace environment and current Go builder compatibility."
  java:
    description: "Tmuxp workspace environment and current Java builder compatibility."
  dotnet:
    description: "Tmuxp workspace environment and current .NET builder compatibility."
  cxx:
    description: "Tmuxp workspace environment and current C++ builder compatibility."
  swift:
    description: "Tmuxp workspace environment and current Swift builder compatibility."
---
<!-- port:py -->
This page documents Python tmuxp configuration at the pinned reference revision.
Use tmuxp for the command examples below.
<!-- /port -->
<!-- port:ts,rs,go,java,dotnet,cxx,swift -->
**tmuxp compatibility reference.** Examples using `tmuxp` run the Python reference. [Local CLI status](../../reference/compatibility/) describes this port's implemented coverage.
<!-- /port -->

The environment of the process running tmuxp controls discovery, expansion, and
presentation. A workspace's `"environment"` mapping controls the tmux session or
the environment passed when launching a pane. These are separate settings.

```yaml
session_name: environment-example
environment:
  WORKSPACE_ROLE: shared
windows:
  - window_name: main
    environment:
      WINDOW_ROLE: tools
    panes:
      - echo window environment
      - environment:
          PANE_ROLE: isolated
        shell_command: env
```

The first pane receives the window launch map. The second selects its own pane
map instead of merging it with the window map. It still inherits applicable tmux
session/process environment. A pane map does not mean a completely empty
environment plus that map.

## Expansion before launch

Tmuxp expands tilde and environment-variable expressions in session/window
names, paths, before_script, command strings, environment values, and string
option values. It uses the environment of the process invoking tmuxp. It does
not first populate that process environment from the workspace's environment
mapping.

For example, a command using an already-set process variable can be substituted
before pane creation. Inspect the expanded intent when a variable should instead
be read dynamically by a pane shell. Unknown variables and shell-specific
expressions follow the loader's expansion and the eventual shell's rules, not a
general template language.

## CLI and runtime variables

| Variables | Effect |
| --- | --- |
| `TMUXP_CONFIGDIR`, `XDG_CONFIG_HOME`, `HOME` | Global workspace directory selection and home expansion |
| `TMUXINATOR_CONFIG` | Tmuxinator import source directory |
| `$EDITOR` | Editor executable; reference default is vim |
| `$TMUX`, `$TMUX_PANE` | Current tmux connection and shell object context |
| `TMUXP_PROGRESS` | Value 0 disables animated load progress |
| `TMUXP_PROGRESS_FORMAT` | Default/minimal/window/pane/verbose preset or custom tokens |
| `TMUXP_PROGRESS_LINES` | Script panel lines: default 3, 0 hides, -1 caps to terminal height |
| `TMUXP_DETECT_TERMINAL_SIZE` | Value 1 enables size detection; default 1 |
| `TMUXP_DEFAULT_COLUMNS`, `TMUXP_DEFAULT_ROWS` | Fallback session dimensions |
| `COLUMNS`, `LINES`, `ROWS` | Terminal helper overrides and fallback sizing inputs |
| `NO_COLOR`, `FORCE_COLOR` | Color policy; nonempty values are significant |
| `PYTHONSTARTUP` | Startup file used by supported shell startup behavior |
| `IPYTHON_ARGUMENTS` | Whitespace-split arguments for the IPython backend |
| `PYTHONBREAKPOINT` | Can affect debugger selection in tmuxp shell |
| `SHELL` | Shell diagnostics and readiness fallback |
| `DISABLE_AUTO_TITLE` | Oh My Zsh automatic-title warning |
| `PATH` | Executable lookup and diagnostics |
| `LIBTMUX_TMUX_FORMAT_SEPARATOR` | Python libtmux format collection override |

Explicit progress flags take precedence over their corresponding defaults.
Nonempty NO_COLOR disables color even with always; otherwise explicit
never/always precede FORCE_COLOR and automatic TTY detection. Machine-output
extensions must disable ANSI regardless of forced color.

`CLICOLOR` and `CLICOLOR_FORCE` are proposed cross-port presentation extensions,
not variables read by this tmuxp reference. Native format codecs also need
separate evidence before claiming the Python separator override works.

See [directories](../directories/) for existing-directory precedence,
[layouts](../layouts/) for size resolution, and [shell](../../cli/shell/) for
Python-specific environment effects.
<!-- port:ts -->

## Current TypeScript builder

The strict schema does not implement tmuxp environment maps or full
interpolation. Node support in the package does not supply Bun's YAML parser.

See the [native builder behavior](../../internals/topics/) and [configuration
source](https://github.com/libtmux/libtmux-ts/blob/f85b8de551353f746d50eaf36bf0112f4fe5a528/packages/workspace/src/config.ts)
before using these fields through application code.
<!-- /port -->
<!-- port:rs -->

## Current Rust builder

Environment maps are present in the model. Variable interpolation and tmuxp
pane/window environment selection are separate execution requirements and must
not be inferred from those fields.

See the [native builder behavior](../../internals/topics/) and [configuration
source](https://github.com/libtmux/libtmux-rs/blob/4a9afac1d82d9a6a9af16099e7b846e69f0e6388/crates/tmux-workspace/src/config.rs)
before using these fields through application code.
<!-- /port -->
<!-- port:go -->

## Current Go builder

Go writes environment entries from every level to the session. The last
assignment remains visible to later processes. This differs from the reference
per-pane launch environment and can expose a pane value to later panes.

See the [native builder behavior](../../internals/topics/) and [configuration
source](https://github.com/libtmux/libtmux-go/blob/bb48780c49652d6b7a17884f19a93c269f04a688/workspace/workspace.go)
before using these fields through application code.
<!-- /port -->
<!-- port:java -->

## Native Java CLI

The local CLI accepts session environment and window/pane launch maps. Window
environment applies when a pane has no map; a pane map replaces it. Names,
directories, environment values and option strings expand tilde and defined
invoking-process variables. Shell command text retains variables for the pane
shell. Session-local environment is currently omitted by native capture; a
whole-session environment round trip is not claimed.

See the [CLI configuration parser](https://github.com/libtmux/libtmux-java/blob/2d7e8028986b99c8e9496dc40b5d1e90fb2368c9/workspace-cli/src/main/java/io/github/libtmux/workspace/cli/WorkspacePlan.java).
Application code using the lower-level workspace library has a separate
[builder API](../../internals/topics/). Its schema is not the CLI configuration
contract.
<!-- /port -->
<!-- port:dotnet -->

## Current .NET builder

The configuration subset does not implement the full session/window/pane
environment and variable expansion described here. The CLI progress/color
variables are reference behavior, not .NET builder settings.

See the [native builder behavior](../../internals/topics/) and [configuration
source](https://github.com/libtmux/libtmux-dotnet/blob/b71b9654f41785c93717e454cbf176672b3d634a/src/LibTmux.Workspace/WorkspaceYamlParser.cs)
before using these fields through application code.
<!-- /port -->
<!-- port:cxx -->

## Current C++ builder

The parser accepts supported environment values, but tmuxp expansion and
pane/window selection must be checked against native execution. Core format
separator behavior is a codec concern, not a workspace print option.

See the [native builder behavior](../../internals/topics/) and [configuration
source](https://github.com/libtmux/libtmux-cxx/blob/c7f1146d2ebd7a8323d9f9814517dc3cdf86b4ee/examples/workspace/src/tmuxp.cpp)
before using these fields through application code.
<!-- /port -->
<!-- port:swift -->

## Current Swift builder

Tmuxp environment expansion and session/window/pane environment maps are outside
the current Swift model. YAML support itself requires opting in to the
YAMLWorkspaces trait.

See the [native builder behavior](../../internals/topics/) and [configuration
source](https://github.com/libtmux/libtmux-swift/blob/94b9e4cc436dda8e18e064179ae7d26e55bbbd73/Sources/TmuxWorkspace/Workspace.swift)
before using these fields through application code.
<!-- /port -->

## Reference source

[loader.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/workspace/loader.py); [finders.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/workspace/finders.py); [classic.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/workspace/builder/classic.py); [load.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/load.py); [shell.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/shell.py); [shell.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/shell.py); [colors.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/_internal/colors.py); [util.py](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/util.py).
