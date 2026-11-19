---
port: java
route: examples/attach-and-send-keys
title: Attach and send keys
description: Get a session handle, send a command to a pane, and capture output.
sidebar:
  label: Attach and send keys
  group: Examples
  order: 2
tableOfContents: true
---

Get a session handle, send a command to a pane, and capture output. These
examples use libtmux from your program; to attach your terminal interactively,
see [Attaching to tmux](/guides/attaching-to-tmux/).

The program creates a private tmux server with its own socket, so it never
touches a server you already run. It stops that server before it exits. [Setup
and run](#setup-and-run) lists what to install.

```java title="AttachAndSendKeys.java"
import io.github.libtmux.Pane;
import io.github.libtmux.Server;
import io.github.libtmux.ServerConfig;
import io.github.libtmux.ServerEndpoint;
import io.github.libtmux.Session;
import io.github.libtmux.TextOutcome;
import io.github.libtmux.Window;
import java.nio.file.Path;
import java.time.Duration;
import java.util.UUID;

public final class AttachAndSendKeys {
    public static void main(String[] args) throws Exception {
        // A server of its own on a private socket.
        String socket = "libtmux-" + UUID.randomUUID();
        ServerConfig config = ServerConfig.builder()
                .endpoint(ServerEndpoint.namedSocket(socket))
                .configFile(Path.of("/dev/null"))
                .defaultTimeout(Duration.ofSeconds(5))
                .build();
        try (Server server = Server.open(config)) {
            try {
                Session session = server.newSession(spec -> spec
                        .named("build").running("sh").env("ENV", "/dev/null"));
                Window window = session.newWindow(spec -> spec
                        .named("tests").running("sh").env("ENV", "/dev/null"));
                Pane pane = window.activePane().orElseThrow();
                System.out.printf("%s:%s %s%n",
                        session.name(), window.name(), pane.id());

                // The format string keeps the echoed command from matching
                // the wait.
                pane.sendLine("printf 'hello from %s\\n' tmux");
                TextOutcome seen = pane.awaitText(
                        "hello from tmux", Duration.ofSeconds(5));
                if (seen == TextOutcome.TIMED_OUT) {
                    throw new IllegalStateException(
                            "The pane did not print the line");
                }
                System.out.println("the pane printed it");

                for (String line : pane.capture()) {
                    if (!line.isEmpty()) {
                        System.out.println("| " + line);
                    }
                }
            } finally {
                // Closing the client leaves tmux running, so stop it here.
                server.killServer();
            }
        }
    }
}
```

## Finding an existing session instead

For a script that runs repeatedly, look up a session before creating it.
[Attaching to
tmux](/guides/attaching-to-tmux/#finding-a-session-instead-of-always-creating-one)
shows that pattern, and [Filtering and querying, in
practice](/guides/querying-and-filtering/) covers absent and ambiguous matches.

## Setup and run

Use an empty directory with tmux 3.3a or newer, JDK 25 and Gradle 9. The build
file installs `io.github.libtmux:libtmux` 0.1.2 from Maven Central. Save the
program as `AttachAndSendKeys.java` and these files beside it:

```kotlin title="settings.gradle.kts"
rootProject.name = "attach"
```

```kotlin title="build.gradle.kts"
plugins {
    application
}

repositories { mavenCentral() }
dependencies {
    implementation("io.github.libtmux:libtmux:0.1.2")
}
java { toolchain { languageVersion.set(JavaLanguageVersion.of(25)) } }
sourceSets.main { java.srcDir("."); java.include("AttachAndSendKeys.java") }
application { mainClass.set("AttachAndSendKeys") }
```

```console
$ gradle --console=plain --no-daemon run
```

<a id="source-inclusion"></a>

## Where this comes from

This program uses `io.github.libtmux:libtmux` 0.1.2 from Maven Central. Its
[source](https://github.com/libtmux/libtmux-java/tree/e8a39689d8d60968ac978a1dd2a89c6112333896/libtmux)
is on GitHub.
