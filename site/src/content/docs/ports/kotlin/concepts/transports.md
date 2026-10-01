---
port: kotlin
route: concepts/transports
title: Commands and control mode
description: Use Kotlin command calls and persistent control connections with explicit cleanup.
sidebar:
  label: Commands and control mode
  group: Concepts
  order: 5
tableOfContents: true
---

Choose command calls for bounded operations and a control connection when you need a persistent tmux client. Closing a client releases its resources; it does not mean the tmux server should be stopped.

[`withServer`](../../reference/io-github-libtmux-kotlin-withserver/) closes the borrowed client scope. Suspended command calls use the configured execution policy. A suspend function is not itself a persistent control connection; open one explicitly with [`withControl`](../../reference/io-github-libtmux-kotlin-withcontrol/).

## Setup and run

Use an empty directory on Linux with Git, tmux 3.2a or newer, and JDK 25. Save the project files and launcher below, then save any complete program on this page. Each program has its own imports and entry point.

The pinned source checkout supplies the Gradle wrapper and the library dependency.

```kotlin title="settings.gradle.kts"
rootProject.name = "connect"
includeBuild("libtmux-source")
```

```kotlin title="build.gradle.kts"
val example = providers.gradleProperty("example").getOrElse("Local")

plugins {
    application
    kotlin("jvm") version "2.4.10"
}

repositories { mavenCentral() }
dependencies {
    implementation("io.github.libtmux:libtmux-kotlin:0.0.1-alpha.17-SNAPSHOT")
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

The launcher creates two sessions on a private socket: `work-one` with an `editor` window, and `work-two` with a `logs` window. Each pane runs `cat` so it stays alive. It stops only this server when the program finishes or fails. If shutdown fails, it reports the retained directory and exits with an error.

```sh title="run.sh"
#!/bin/sh
set -eu

binary=$(command -v tmux)
mkdir -p /tmp/libtmux-java-dev
directory=$(mktemp -d /tmp/libtmux-java-dev/query.XXXXXX)
socket="$directory/tmux.sock"

cleanup() {
    status=$?
    trap - 0 HUP INT TERM
    if [ -S "$socket" ] && ! "$binary" -S "$socket" kill-server; then
        printf 'Cannot stop tmux; kept %s\n' "$directory" >&2
        exit 1
    fi
    rm -rf "$directory" || exit 1
    exit "$status"
}
trap cleanup 0
trap 'exit 1' HUP INT TERM

unset TMUX TMUX_PANE
export LIBTMUX_SOCKET_PATH="$socket" TMUX_BIN="$binary"
"$binary" -S "$socket" -f /dev/null new-session -d -s work-one -n editor /bin/cat
"$binary" -S "$socket" new-session -d -s work-two -n logs /bin/cat
"$@"
"$binary" -S "$socket" has-session -t '=work-one'
```

Fetch the library revision used by these examples:

```console
$ git clone https://github.com/libtmux/libtmux-java libtmux-source &&
  git -C libtmux-source checkout be1d62fbaa1aa634c687e1c50bceeb09ef0b8a15
```

Each run starts from the same two-session fixture. Programs do not depend on another example having run first. Their assertions fail if the observed result differs.

## Run a bounded command and inspect its result

Read the session list and filter it locally. The connection uses a five-second timeout so an unavailable server fails visibly.

```kotlin title="Local.kt"
import io.github.libtmux.ServerConfig
import io.github.libtmux.ServerEndpoint
import io.github.libtmux.kotlin.*
import io.github.libtmux.kotlin.query.*
import java.nio.file.Path
import java.time.Duration
import kotlinx.coroutines.runBlocking

fun main() = runBlocking {
    val socket = requireNotNull(System.getenv("LIBTMUX_SOCKET_PATH")) {
        "Set LIBTMUX_SOCKET_PATH to an existing socket"
    }
    val config = ServerConfig.builder()
        .endpoint(ServerEndpoint.socketPath(Path.of(socket)))
        .defaultTimeout(Duration.ofSeconds(5))
        .build()
    withServer(config) { server ->
        val sessions = server.sessions()
        val matching = sessions.filter(Session.name startsWith "work-")
        val names = matching.map { it.name }.sorted()
        check(names == listOf("work-one", "work-two"))
        println(names.joinToString(", "))
        // Filtering the captured list makes no new tmux calls.
        check(sessions.filter { it.name.startsWith("work-") } == matching)
        val onlyOne = (Session.name startsWith "work-").and(Session.name endsWith "one")
        check(sessions.filter(onlyOne).single().name == "work-one")
        val either = (Session.name eq "work-one").or(Session.name eq "work-two")
        check(sessions.filter(either).size == 2)
        check(sessions.filter(!(Session.name eq "work-one")).single().name == "work-two")
    }
}
```

```console
$ sh run.sh ./libtmux-source/gradlew --project-dir . run \
  -Pexample=Local --console=plain --max-workers=2
```

Expected program output:

```text
work-one, work-two
```

## Open and close a control client

Send `list-sessions` over a persistent control connection, verify the response, then close the control client. A subsequent ordinary read verifies the tmux server still has both sessions.

```kotlin title="Control.kt"
import io.github.libtmux.ServerConfig
import io.github.libtmux.ServerEndpoint
import io.github.libtmux.kotlin.*
import io.github.libtmux.kotlin.query.*
import java.nio.file.Path
import java.time.Duration
import kotlinx.coroutines.runBlocking

fun main() = runBlocking {
    val socket = requireNotNull(System.getenv("LIBTMUX_SOCKET_PATH")) {
        "Set LIBTMUX_SOCKET_PATH to an existing socket"
    }
    val config = ServerConfig.builder()
        .endpoint(ServerEndpoint.socketPath(Path.of(socket)))
        .defaultTimeout(Duration.ofSeconds(5))
        .build()
    withServer(config) { server ->
        val session = server.sessions().single { it.name == "work-one" }
        withControl(server, session) { control ->
            val reply = control.send("list-sessions", "-F", "#{session_name}")
            check(reply.succeeded()) { "tmux rejected list-sessions: ${reply.outcome()}" }
            val names = reply.lines().sorted()
            check(names == listOf("work-one", "work-two"))
            println(names.joinToString(", "))
        }
        check(server.sessions().size == 2)
        println("control client closed; server still running")
    }
}
```

```console
$ sh run.sh ./libtmux-source/gradlew --project-dir . run \
  -Pexample=Control --console=plain --max-workers=2
```

Expected program output:

```text
work-one, work-two
control client closed; server still running
```

## Timeouts and ownership

An operation that times out may already have reached tmux. Read the current state before retrying a mutation such as creating a window. A cancellation signal does not roll back a completed tmux command.

Here the launcher owns the private server and stops it after the program exits. An application connecting to an existing server should close its own client resources and leave that server running. See [attaching to tmux](../../guides/attaching-to-tmux/) for the connection-only example.
