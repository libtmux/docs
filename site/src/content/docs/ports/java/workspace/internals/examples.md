---
title: "Java workspace builder examples"
description: "Internal examples for building and inspecting workspaces through the Java API."
port: java
product: workspace
sidebar:
  group: Internals
  label: Examples
  order: 3
tableOfContents: true
---

Build a two-window workspace, inspect its panes, and remove the private tmux
server. Use a POSIX host with tmux on `PATH` and JDK 25.

## Create the project

In a new directory, fetch the source revision used by this documentation:

```console
$ mkdir java-workspace-example
$ cd java-workspace-example
$ git init -q libtmux-source
$ git -C libtmux-source remote add origin https://github.com/libtmux/libtmux-java.git
$ git -C libtmux-source fetch --depth=1 origin 842228310449e879ebcaa3f910597757c9dbffd6
$ git -C libtmux-source checkout --detach FETCH_HEAD
$ mkdir -p src/main/java
```

Save this as `settings.gradle.kts`. The included build supplies the workspace
module and its core dependency from the selected source. Its toolchain resolver
downloads the Temurin 21 compiler for those libraries when needed.

```kotlin title="settings.gradle.kts"
rootProject.name = "workspace-example"
includeBuild("libtmux-source")
```

Save this as `build.gradle.kts`:

```kotlin title="build.gradle.kts"
plugins {
    application
}

repositories {
    mavenCentral()
}

dependencies {
    implementation("io.github.libtmux:libtmux-workspace:0.0.1-alpha.12-SNAPSHOT")
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

Use the checked-out Gradle wrapper to run the application:

```console
$ ./libtmux-source/gradlew --no-daemon --max-workers=2 -p . run
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

[Workspace API source](https://github.com/libtmux/libtmux-java/tree/842228310449e879ebcaa3f910597757c9dbffd6/libtmux-workspace/src/main/java/io/github/libtmux/workspace)
