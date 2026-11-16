---
port: kotlin
route: guides/attaching-to-tmux
title: Attaching to tmux
description: Connect to an existing tmux server and find a session with Kotlin.
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

Save the complete program as `Connect.kt`. When `LIBTMUX_SOCKET_PATH` names
the socket of a running server, `printWork` opens a new `Server` handle on that
socket and finds the `work` session. The program leaves that server running.

Without the variable, the program starts a private server with a `work` session
running `cat`, reads it through a separate handle in the same way, and then
stops the server it started and removes its socket directory. If that server
cannot be stopped, the program reports the retained directory and exits with
an error.

```kotlin title="Connect.kt"
import io.github.libtmux.ServerConfig
import io.github.libtmux.ServerEndpoint
import io.github.libtmux.kotlin.killServer
import io.github.libtmux.kotlin.newSession
import io.github.libtmux.kotlin.sessions
import io.github.libtmux.kotlin.withServer
import java.nio.file.Files
import java.nio.file.Path
import java.time.Duration
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext

fun main() = runBlocking {
    val existing = System.getenv("LIBTMUX_SOCKET_PATH")
    if (existing != null) printWork(Path.of(existing)) else demonstrate()
}

// A new Server handle reaches a running server through its socket path.
suspend fun printWork(socket: Path) {
    val config = ServerConfig.builder()
        .endpoint(ServerEndpoint.socketPath(socket))
        .defaultTimeout(Duration.ofSeconds(5))
        .build()
    withServer(config) { server ->
        val session = server.sessions().single { it.name == "work" }
        println(session.name)
    }
}

// Without LIBTMUX_SOCKET_PATH, start a private server to attach to.
suspend fun demonstrate() {
    val directory = Files.createTempDirectory("libtmux-attach-")
    val socket = directory.resolve("tmux.sock")
    val config = ServerConfig.builder()
        .endpoint(ServerEndpoint.socketPath(socket))
        .configFile(Path.of("/dev/null"))
        .defaultTimeout(Duration.ofSeconds(5))
        .build()
    var stopped = false
    try {
        withServer(config) { owner ->
            try {
                owner.newSession {
                    name = "work"
                    running("/bin/cat")
                }
                printWork(socket)
            } finally {
                withContext(NonCancellable) {
                    if (Files.exists(socket)) owner.killServer()
                    stopped = true
                }
            }
        }
    } finally {
        if (stopped || !Files.exists(socket)) {
            Files.deleteIfExists(socket)
            Files.delete(directory)
        } else {
            System.err.println("Cannot stop tmux; kept $directory")
        }
    }
}
```

## Setup and run

Use an empty directory on Linux with tmux 3.3a or newer, JDK 25 and Gradle 9.
The build file installs `libtmux-kotlin` 0.1.2 from Maven Central
([source](https://github.com/libtmux/libtmux-java/tree/e8a39689d8d60968ac978a1dd2a89c6112333896/libtmux-kotlin)).

This example was checked with JDK 25.0.3, Gradle 9.7.0 and Kotlin 2.4.10.

Save this file beside the program using the displayed filename.

```kotlin title="build.gradle.kts"
plugins {
    application
    kotlin("jvm") version "2.4.10"
}

repositories { mavenCentral() }
dependencies {
    implementation("io.github.libtmux:libtmux-kotlin:0.1.2")
}
kotlin {
    jvmToolchain(25)
    sourceSets.main { kotlin.srcDir("."); kotlin.include("Connect.kt") }
}
application { mainClass.set("ConnectKt") }
```

Save this file beside the program using the displayed filename.

```kotlin title="settings.gradle.kts"
rootProject.name = "connect"
```

Save this file beside the program using the displayed filename.

```properties title="gradle.properties"
org.gradle.jvmargs=-Xmx2g -XX:MaxMetaspaceSize=768m -Dfile.encoding=UTF-8
kotlin.daemon.jvmargs=-Xmx2g
org.gradle.workers.max=2
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
[Capture pane output](/examples/capture-pane-output/).
