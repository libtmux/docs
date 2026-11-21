---
port: java
route: guides/attaching-to-tmux
title: Attaching to tmux
description: Connect to an existing tmux server and find a session with Java.
sidebar:
  label: Attaching to tmux
  group: Guides
  order: 3
tableOfContents: true
---

Connect a `Server` to an explicit socket and find the existing `work` session.
The program prints its name and leaves the tmux server running. It reports an
error if the connection fails or the session is absent.

This controls tmux from your program. To open a session in your terminal, use
`tmux attach-session`; the [shared guide](../../../../tmux/guides/attaching-to-tmux/) covers
interactive attachment and detaching.

<a id="which-socket-a-bare-constructor-reaches"></a>

## Connect to an existing server

Save the complete program as `Connect.java`. When `LIBTMUX_SOCKET_PATH` names
the socket of a running server, `printWork` opens a new `Server` handle on that
socket and finds the `work` session. The program leaves that server running.

Without the variable, the program starts a private server with a `work` session
running `cat`, reads it through a separate handle in the same way, and then
stops the server it started and removes its socket directory. If that server
cannot be stopped, the program reports the retained directory and exits with
an error.

```java title="Connect.java" role="program"
import io.github.libtmux.Server;
import io.github.libtmux.ServerConfig;
import io.github.libtmux.ServerEndpoint;
import io.github.libtmux.Session;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;

public final class Connect {
    public static void main(String[] args) throws IOException {
        String existing = System.getenv("LIBTMUX_SOCKET_PATH");
        if (existing != null) {
            printWork(Path.of(existing));
        } else {
            demonstrate();
        }
    }

    // A new Server handle reaches a running server through its socket path.
    static void printWork(Path socket) {
        ServerConfig config = ServerConfig.builder()
                .endpoint(ServerEndpoint.socketPath(socket))
                .defaultTimeout(Duration.ofSeconds(5))
                .build();
        try (Server server = Server.open(config)) {
            Session session = server.sessions().stream()
                    .filter(candidate -> candidate.name().equals("work"))
                    .findFirst()
                    .orElseThrow(() -> new IllegalStateException(
                            "The work session does not exist"));
            System.out.println(session.name());
        }
    }

    // Without LIBTMUX_SOCKET_PATH, start a private server to attach to.
    static void demonstrate() throws IOException {
        Path directory = Files.createTempDirectory("libtmux-attach-");
        Path socket = directory.resolve("tmux.sock");
        ServerConfig config = ServerConfig.builder()
                .endpoint(ServerEndpoint.socketPath(socket))
                .configFile(Path.of("/dev/null"))
                .defaultTimeout(Duration.ofSeconds(5))
                .build();
        boolean stopped = false;
        try (Server owner = Server.open(config)) {
            try {
                owner.newSession(s -> s.named("work").running("/bin/cat"));
                printWork(socket);
            } finally {
                if (Files.exists(socket)) owner.killServer();
                stopped = true;
            }
        } finally {
            if (stopped || !Files.exists(socket)) {
                Files.deleteIfExists(socket);
                Files.delete(directory);
            } else {
                System.err.println("Cannot stop tmux; kept " + directory);
            }
        }
    }
}
```

## Setup and run

Use an empty directory on Linux with tmux 3.3a or newer, JDK 25 and Gradle 9.
The build file installs `io.github.libtmux:libtmux` 0.1.2 from Maven Central
([source](https://github.com/libtmux/libtmux-java/tree/e8a39689d8d60968ac978a1dd2a89c6112333896/libtmux)).

This example was checked with JDK 25.0.3 and Gradle 9.7.0.

Save this file beside the program using the displayed filename.

```kotlin title="build.gradle.kts"
plugins {
    application
}

repositories { mavenCentral() }
dependencies {
    implementation("io.github.libtmux:libtmux:0.1.2")
}
java { toolchain { languageVersion.set(JavaLanguageVersion.of(25)) } }
sourceSets.main { java.srcDir("."); java.include("Connect.java") }
application { mainClass.set("Connect") }
```

Save this file beside the program using the displayed filename.

```kotlin title="settings.gradle.kts"
rootProject.name = "connect"
```

Build and run the program:

```console
$ gradle --console=plain --no-daemon run
```

The program prints `work`. To attach to a server of your own, set
`LIBTMUX_SOCKET_PATH` to its socket path before running the same command.

<a id="finding-a-session-instead-of-always-creating-one"></a>

## Find or create a session

The example only looks up a session. If your application creates a session
after an unsuccessful lookup, another client may create the same name between
those operations. Handle the creation error instead of assuming the lookup
reserves the name.

For a complete program that starts and owns its server, see
[Capture pane output](/examples/capture-pane-output/). Continue with
[Sending keys](/guides/sending-keys/) once you have a pane handle.
