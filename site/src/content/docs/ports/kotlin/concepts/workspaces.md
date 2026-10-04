---
port: kotlin
route: concepts/workspaces
title: Layouts and repeated setup
description: Create and reuse Kotlin tmux layouts while preserving running processes.
sidebar:
  label: Layouts and repeated setup
  group: Concepts
  order: 6
tableOfContents: true
---

Build a tmux layout from Kotlin by creating a window, splitting a pane and selecting a layout. Capture again to inspect the result. The examples use the library APIs directly and give every pane a command that stays alive.

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
"$binary" -S "$socket" -f /dev/null \
    new-session -d -s work-one -n editor /bin/cat
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

## Create a two-pane tools window

Create `tools` in `work-one`, split its pane to the right, then choose `even-horizontal`. The final read verifies two panes. The previously captured session does not automatically gain the new window.

```kotlin title="Layout.kt"
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
        val window = session.newWindow(io.github.libtmux.WindowSpec.builder()
            .named("tools").running("/bin/cat").build())
        val original = window.panes.single()
        val right = io.github.libtmux.SplitSpec.builder()
            .toRight()
            .running("/bin/cat")
            .build()
        original.split(right)
        window.selectLayout(io.github.libtmux.Layout.EVEN_HORIZONTAL)
        val refreshed = server.sessions().single { it.name == "work-one" }
        val tools = refreshed.windows.single { it.name == "tools" }
        check(tools.panes.size == 2)
        println("tools: 2 panes")
    }
}
```

```console
$ sh run.sh ./libtmux-source/gradlew --project-dir . run \
  -Pexample=Layout --console=plain --max-workers=2
```

Expected program output:

```text
tools: 2 panes
```

## Reuse a named window

Look for `tools` before creating it. Two sequential calls return the same window ID, and the session has only `editor` and `tools`. This is useful for a setup command you run repeatedly.

```kotlin title="ReuseLayout.kt"
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
        suspend fun ensureTools(): Window {
            val session = server.sessions().single { it.name == "work-one" }
            val existing = session.windows.singleOrNull { it.name == "tools" }
            if (existing != null) return existing
            return session.newWindow(io.github.libtmux.WindowSpec.builder()
                .named("tools").running("/bin/cat").build())
        }
        val first = ensureTools()
        val second = ensureTools()
        check(first.id == second.id)
        val one = server.sessions().single { it.name == "work-one" }
        check(one.windows.size == 2)
        println("one tools window after two calls")
    }
}
```

```console
$ sh run.sh ./libtmux-source/gradlew --project-dir . run \
  -Pexample=ReuseLayout --console=plain --max-workers=2
```

Expected program output:

```text
one tools window after two calls
```

## Decide what repeated setup means

The reuse example preserves the existing window and its running processes. It does not reset its pane count, layout or commands. Choose that policy deliberately when building a reusable workspace command.

This check-then-create sequence assumes one writer. Concurrent callers can both observe an absent window and create duplicates. Serialize setup in your application when several callers share a session. A later failure also leaves earlier successful mutations in place; tmux commands are not a transaction.

Use [filtering and queries](../queries/) for stricter target selection and [captured handles](../server-session-window-pane/) to understand refresh behavior.
