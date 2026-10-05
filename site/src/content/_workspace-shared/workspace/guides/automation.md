---
description: Run detached commands with explicit inputs and machine-readable results.
product: workspace
sidebar:
  group: Guides
  label: Automate workspace operations
  order: 25
tableOfContents: true
title: Automate workspace operations
---

<!-- port:py -->
Pass an explicit workspace file, dedicated socket and `-d` when running tmuxp
from a script. `--yes` answers confirmations; it does not supply every missing
choice.

```console
$ tmuxp load -L workspace-guide -d workspace.yaml
```

Use `ls --json` to read discovered workspace records:

```console
$ tmuxp ls --json
```

The output is an object with a `workspaces` array. Search has different empty
output and error behavior; read [search](../../cli/search/) and
[exit codes](../../reference/exit-codes/) before building a pipeline.

Use [export and reload](../export-session/) to capture a session. Review the
resulting commands and paths rather than treating capture as a complete backup.
<!-- /port -->

<!-- port:ts,rs,go,java,csharp,cxx,swift -->
Give automation an explicit file, endpoint and attachment choice. Continue the
[installation walkthrough](../installation/) with this detached operation:

```console
$ tmux-workspace load \
    -S "$WORKSPACE_TMP/tmux.sock" \
    -d \
    --json \
    workspace.yaml
```

Check the process exit status, parse its JSON result, then inspect any reported
partial effects. A failed later input does not imply that earlier sessions
were removed. Keep stderr separate from the result stream.

## Follow progress

Use NDJSON when the caller needs records while a load is running:

```console
$ tmux-workspace load \
    -S "$WORKSPACE_TMP/tmux.sock" \
    -d \
    --ndjson \
    workspace.yaml
```

Parse one complete JSON value per line. Treat a closed stream or missing final
result as incomplete work. Do not infer success from an earlier creation event.

## Make retries deliberate

Use a unique session name for independent jobs. Reusing a name follows the
loader's existing-session policy; it is not a request to reset that session.
Capture IDs and retained effects from the result before deciding what to clean
up or retry. Remove only sessions the job owns.

Read [output](../../reference/output/) and [errors](../../reference/exit-codes/)
for the command's machine interface. A pane's process can outlive the CLI and
can fail after successful command delivery.

<!-- port:ts -->
[CLI source](https://github.com/libtmux/libtmux-ts/blob/f36d692552bb9a373b45338bb5fece854e57cc3d/packages/workspace-cli/README.md).
<!-- /port -->
<!-- port:rs -->
[CLI source](https://github.com/libtmux/libtmux-rs/blob/e9be0b6f6d22cd2eb79b0ec08964f82e717e5fe4/crates/tmux-workspace/docs/cli.md).
<!-- /port -->
<!-- port:go -->
[CLI source](https://github.com/libtmux/libtmux-go/blob/bb06e26e116e941813ca40bf45e7e3a47d38f52a/workspace/CLI.md).
<!-- /port -->
<!-- port:java -->
[CLI source](https://github.com/libtmux/libtmux-java/blob/3e5b20d22af3890ae5f7f52842e4b05d170a983f/libtmux-workspace-cli/README.md).
<!-- /port -->
<!-- port:csharp -->
[CLI source](https://github.com/libtmux/libtmux-dotnet/blob/f77fe776ba67a04abb20ddbbc26cf4a000d63b74/src/LibTmux.Workspace.Cli/README.md).
<!-- /port -->
<!-- port:cxx -->
[CLI source](https://github.com/libtmux/libtmux-cxx/blob/9c8c6a264114277df84c9f6819855093adae5c6e/apps/workspace/README.md).
<!-- /port -->
<!-- port:swift -->
[CLI source](https://github.com/libtmux/libtmux-swift/blob/53c67947879f4976ddf2c43f3c8df7c7671c5b19/Sources/TmuxWorkspaceCLI/README.md).
<!-- /port -->
<!-- /port -->
