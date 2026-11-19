---
port: kotlin
route: concepts/server-session-window-pane
title: Server, session, window, pane
description: Traverse captured Kotlin handles, retain IDs and refresh after changes.
sidebar:
  label: Server, session, window, pane
  group: Concepts
  order: 2
tableOfContents: true
---

Capture a hierarchy, then read its sessions, windows and panes locally. Handles retain the state they captured; a rename does not rewrite an older handle. Use a new capture to observe later changes.

[`Server`](../../reference/io-github-libtmux-kotlin-server/) selects the socket and owns client resources. [`Session`](../../reference/io-github-libtmux-kotlin-session/), [`Window`](../../reference/io-github-libtmux-kotlin-window/) and [`Pane`](../../reference/io-github-libtmux-kotlin-pane/) hold captured state and send mutations through that server. The session list captures the hierarchy; walking its children reads that capture.

A session holds window placements; a window holds panes. A linked window can appear in several sessions, so traversal counts placements rather than necessarily distinct physical windows. Names can change; retain IDs when identifying a target.

## Setup and run

Use an empty directory on Linux with tmux 3.3a or newer, JDK 25, and Gradle 9. Save the project files below, then save any complete program on this page. Each program has its own imports and entry point.

Gradle resolves `libtmux-kotlin` 0.1.2 from Maven Central ([source](https://github.com/libtmux/libtmux-java/tree/e8a39689d8d60968ac978a1dd2a89c6112333896/libtmux-kotlin)).

```kotlin title="settings.gradle.kts"
rootProject.name = "connect"
```

```kotlin title="build.gradle.kts"
val example = providers.gradleProperty("example").getOrElse("Local")

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
    sourceSets.main { kotlin.srcDir("."); kotlin.include("${example}.kt") }
}
application { mainClass.set("${example}Kt") }
```

```properties title="gradle.properties"
org.gradle.jvmargs=-Xmx2g -XX:MaxMetaspaceSize=768m -Dfile.encoding=UTF-8
kotlin.daemon.jvmargs=-Xmx2g
org.gradle.workers.max=2
```

Each program starts its own private tmux server with two sessions: `work-one` with an `editor` window, and `work-two` with a `logs` window. Each pane runs `cat` so it stays alive. The program stops only that server when it finishes or fails, then removes the server's directory. If shutdown fails, it reports the retained directory and exits with an error.

Each run starts from the same two-session fixture. Programs do not depend on another example having run first. Their assertions fail if the observed result differs.

## Walk sessions, windows and panes

Flatten the captured children and verify the fixture contains two of each. The program also prints each session and its window.

```kotlin title="Hierarchy.kt"
import io.github.libtmux.ServerConfig
import io.github.libtmux.ServerEndpoint
import io.github.libtmux.kotlin.*
import io.github.libtmux.kotlin.query.*
import java.nio.file.Files
import java.nio.file.Path
import java.time.Duration
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext

suspend fun demonstrate(server: Server) {
    val sessions = server.sessions()
    val windows = sessions.flatMap { it.windows }
    val panes = windows.flatMap { it.panes }
    check(sessions.size == 2 && windows.size == 2 && panes.size == 2)
    for (session in sessions) {
        println("${session.name}: ${session.windows.single().name}")
    }
    println("2 sessions, 2 windows, 2 panes")
}

fun main() = runBlocking {
    val directory = Files.createTempDirectory("libtmux-example-")
    val socket = directory.resolve("tmux.sock")
    val config = ServerConfig.builder()
        .endpoint(ServerEndpoint.socketPath(socket))
        .configFile(Path.of("/dev/null"))
        .defaultTimeout(Duration.ofSeconds(5))
        .build()
    var stopped = false
    try {
        withServer(config) { server ->
            try {
                server.newSession {
                    name = "work-one"
                    window {
                        name = "editor"
                        running("/bin/cat")
                    }
                }
                server.newSession {
                    name = "work-two"
                    window {
                        name = "logs"
                        running("/bin/cat")
                    }
                }
                demonstrate(server)
            } finally {
                withContext(NonCancellable) {
                    if (Files.exists(socket)) server.killServer()
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

```console
$ gradle --console=plain --no-daemon run -Pexample=Hierarchy
```

Expected program output:

```text
work-one: editor
work-two: logs
2 sessions, 2 windows, 2 panes
```

## Observe a rename with a fresh read

Rename the editor window. The old handle still says `editor`; the returned handle and a new server read say `renamed`. This distinction matters when a UI, another client or your own code changes tmux after a capture.

```kotlin title="Refresh.kt"
import io.github.libtmux.ServerConfig
import io.github.libtmux.ServerEndpoint
import io.github.libtmux.kotlin.*
import io.github.libtmux.kotlin.query.*
import java.nio.file.Files
import java.nio.file.Path
import java.time.Duration
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext

suspend fun demonstrate(server: Server) {
    val session = server.sessions().single { it.name == "work-one" }
    val before = session.windows.single()
    val after = before.rename("renamed")
    check(before.name == "editor")
    check(after.name == "renamed")
    val readAgain = server.sessions().single { it.name == "work-one" }
        .windows.single()
    check(readAgain.name == "renamed")
    println("${before.name} -> ${readAgain.name}")
}

fun main() = runBlocking {
    val directory = Files.createTempDirectory("libtmux-example-")
    val socket = directory.resolve("tmux.sock")
    val config = ServerConfig.builder()
        .endpoint(ServerEndpoint.socketPath(socket))
        .configFile(Path.of("/dev/null"))
        .defaultTimeout(Duration.ofSeconds(5))
        .build()
    var stopped = false
    try {
        withServer(config) { server ->
            try {
                server.newSession {
                    name = "work-one"
                    window {
                        name = "editor"
                        running("/bin/cat")
                    }
                }
                server.newSession {
                    name = "work-two"
                    window {
                        name = "logs"
                        running("/bin/cat")
                    }
                }
                demonstrate(server)
            } finally {
                withContext(NonCancellable) {
                    if (Files.exists(socket)) server.killServer()
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

```console
$ gradle --console=plain --no-daemon run -Pexample=Refresh
```

Expected program output:

```text
editor -> renamed
```

## Select a target before changing it

A successful lookup does not reserve a tmux object. Another client can remove it before your next command. Handle a command failure at the mutation, and refresh before deciding what to do next. See [filtering and queries](../queries/) for missing and ambiguous selections, and [layouts](../workspaces/) for creation.
