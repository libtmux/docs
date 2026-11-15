---
title: "Java workspace builder examples"
description: "Internal examples for building and inspecting workspaces through the Java API."
port: java
product: workspace
aliases: [examples/workspace-from-file]
sidebar:
  group: Internals
  label: Examples
  order: 3
tableOfContents: true
---

Build a two-window workspace, inspect its panes, and remove the private tmux
server. Use a POSIX host with tmux 3.3a or newer on `PATH`, JDK 25 and Gradle 9.

## Create the project

Create an empty project:

```console
$ mkdir -p java-workspace-example/src/main/java
$ cd java-workspace-example
```

Save the following settings file:

```kotlin title="settings.gradle.kts"
rootProject.name = "workspace-example"
```

Save the following build file. Gradle resolves `libtmux-workspace` 0.1.2 and its core dependency from Maven Central:

```kotlin title="build.gradle.kts"
plugins {
    application
}

repositories {
    mavenCentral()
}

dependencies {
    implementation("io.github.libtmux:libtmux-workspace:0.1.2")
}

java {
    toolchain.languageVersion.set(JavaLanguageVersion.of(25))
}

application {
    mainClass.set("WorkspaceExample")
}
```

## Build and inspect

Save this complete program as `src/main/java/WorkspaceExample.java`:

```java title="src/main/java/WorkspaceExample.java"
import io.github.libtmux.Server;
import io.github.libtmux.ServerEndpoint;
import io.github.libtmux.Session;
import io.github.libtmux.workspace.Workspace;
import io.github.libtmux.workspace.WorkspaceBuilder;
import java.nio.file.Path;
import java.time.Duration;
import java.util.UUID;

public final class WorkspaceExample {
    public static void main(String[] args) {
        Workspace workspace = WorkspaceBuilder.parse("""
                session_name: built
                windows:
                  - window_name: editor
                    layout: even-horizontal
                    panes:
                      - shell_command: echo one
                      - shell_command: echo two
                  - window_name: server
                    panes:
                      - echo three
                """);
        try (Server server = Server.builder()
                .endpoint(ServerEndpoint.namedSocket("workspace-" + UUID.randomUUID()))
                .configFile(Path.of("/dev/null"))
                .defaultTimeout(Duration.ofSeconds(10))
                .build()) {
            try {
                server.newSession("bootstrap");
                Session session = WorkspaceBuilder.build(server, workspace);
                System.out.println(session.name() + ": " + session.windows().size() + " windows");
                System.out.println("editor: " + session.windows().getFirst().panes().size() + " panes");
            } finally {
                server.killServer();
            }
        }
    }
}
```

Run the application:

```console
$ gradle --console=plain --no-daemon run
```

The application prints `built: 2 windows` and `editor: 2 panes`. Its unique
socket prevents a collision with an existing server. The `finally` block
removes that server even if construction or inspection fails. Closing the
Java handle then releases its transport.

The bootstrap session starts tmux before the workspace builder checks its
version. It belongs to the same private server and is removed with it.

Building creates the layout and sends the pane commands. It does not wait for
those programs to finish. Keep the session running instead of calling
`killServer` when adapting this example into an application launcher.

<a id="where-this-comes-from"></a>
<a id="source-inclusion"></a>

[Workspace API source](https://github.com/libtmux/libtmux-java/tree/e8a39689d8d60968ac978a1dd2a89c6112333896/libtmux-workspace/src/main/java/io/github/libtmux/workspace)
