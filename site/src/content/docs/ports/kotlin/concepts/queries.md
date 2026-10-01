---
port: kotlin
route: concepts/queries
title: Filtering and queries
description: Compose Kotlin filters, distinguish zero and several matches, and query captured relations.
sidebar:
  label: Filtering and queries
  group: Concepts
  order: 4
tableOfContents: true
---

Filter captured objects in Kotlin, handle result counts explicitly, and match sessions by their related windows. Local filters read captured values; they do not subscribe to changes or issue a fresh tmux query.

[`TextField`](../../reference/io-github-libtmux-kotlin-query-textfield/) builds typed expressions with `eq`, `ne`, `startsWith`, `endsWith`, `contains`, `oneOf` and `matches`. Compose them with `.and()`, `.or()` and `!`. Ordinary Kotlin predicates remain useful for application-specific conditions.

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

## Match names and combine conditions

Select the two names beginning with `work-`, then assert equality, AND, OR and exclusion against the same captured collection. Matching is case sensitive. The native collection predicate agrees with the typed prefix query.

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

## Distinguish missing and ambiguous results

The program distinguishes zero and one local result. The checked server lookup throws `CardinalityException.MultipleMatches` for two matches. Do not use `singleOrNull()` when zero and several matches need different handling.

```kotlin title="Cardinality.kt"
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
        for (name in listOf("work-one", "missing")) {
            val matches = sessions.filter(Session.name eq name)
            when (matches.size) {
                0 -> println("$name: absent")
                1 -> println("$name: selected")
                else -> error("More than one session named $name")
            }
        }
        val ambiguous = sessions.filter(Session.name startsWith "work-")
        check(ambiguous.size == 2)
        // singleOrNull() alone cannot distinguish zero from several matches.
        try {
            server.session(Session.name startsWith "work-")
            error("Expected an ambiguous selection")
        } catch (error: io.github.libtmux.exception.CardinalityException.MultipleMatches) {
            println("work-: ambiguous")
        }
    }
}
```

```console
$ sh run.sh ./libtmux-source/gradlew --project-dir . run \
  -Pexample=Cardinality --console=plain --max-workers=2
```

Expected program output:

```text
work-one: selected
missing: absent
work-: ambiguous
```

## Filter through related windows

Match sessions with any window named `editor`, then match sessions with none. For an empty captured relation, `any` is false and `none` is true; `all` is true. An uncaptured relation is a different condition and must be captured before filtering.

```kotlin title="Relations.kt"
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
        val editorWindow = Window.name eq "editor"
        val withEditor = sessions.filter(Session.windows any editorWindow)
        val withoutEditor = sessions.filter(Session.windows none editorWindow)
        check(withEditor.map { it.name } == listOf("work-one"))
        check(withoutEditor.map { it.name } == listOf("work-two"))
        println("editor: ${withEditor.single().name}")
        println("no editor: ${withoutEditor.single().name}")
    }
}
```

```console
$ sh run.sh ./libtmux-source/gradlew --project-dir . run \
  -Pexample=Relations --console=plain --max-workers=2
```

Expected program output:

```text
editor: work-one
no editor: work-two
```

## Refresh before repeating a decision

Reusing the same list repeats the same decision over old state. Capture again when you need to observe a rename, new window or closed pane. The [snapshot example](../server-session-window-pane/#observe-a-rename-with-a-fresh-read) shows the old and fresh values side by side.
