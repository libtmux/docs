---
title: "Use the Java workspace builder"
description: "Use the in-development Java workspace builder from application code."
port: java
product: workspace
sidebar:
  group: Internals
  label: Guides
  order: 2
tableOfContents: true
---

Add the workspace module to a Java 21 project. The BOM selects compatible
libtmux modules:

```kotlin
dependencies {
    implementation(platform("io.github.libtmux:libtmux-bom:0.0.1-alpha.10"))
    implementation("io.github.libtmux:libtmux-workspace")
}
```

Install tmux on the host before running the builder.

## Create and inspect

This program builds on a dedicated socket, prints the resulting session name,
and removes the session after inspection. Save it in your application's Java
sources and run it through your existing Gradle application task.

```java
import io.github.libtmux.Server;
import io.github.libtmux.ServerEndpoint;
import io.github.libtmux.Session;
import io.github.libtmux.workspace.Workspace;
import io.github.libtmux.workspace.WorkspaceBuilder;
import java.util.UUID;

public class WorkspaceGuide {
    public static void main(String[] args) {
        Workspace workspace = WorkspaceBuilder.parse("""
                session_name: guide
                windows:
                  - window_name: editor
                    panes:
                      - echo ready
                      - echo ready
                """);
        try (Server server = Server.builder()
                .endpoint(ServerEndpoint.namedSocket(
                        "workspace-" + UUID.randomUUID()))
                .build()) {
            Session session = WorkspaceBuilder.build(server, workspace);
            try {
                System.out.println(session.name());
            } finally {
                session.kill();
            }
        }
    }
}
```

## Read a file

Use `WorkspaceBuilder.read(Path)` to parse YAML from disk. It reports file
read failures as `UncheckedIOException`; invalid configuration raises
`IllegalArgumentException`. Handle those before calling `build`.

For an application that keeps the workspace running, keep the session rather
than calling `kill`. Closing the Java server handle releases its transport;
it does not serve as workspace removal.

If construction fails, inspect the exception and its suppressed cleanup
failures. [Topics](../topics/) describes the builder's cleanup scope.

[Dependency and workspace usage](https://github.com/libtmux/libtmux-java/blob/4f057d367a25dee818d70876fa283fc503a3a7eb/libtmux-workspace/README.md); [Server lifetime API](https://github.com/libtmux/libtmux-java/blob/4f057d367a25dee818d70876fa283fc503a3a7eb/libtmux/src/main/java/io/github/libtmux/Server.java).
