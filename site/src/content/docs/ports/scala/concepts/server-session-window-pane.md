---
port: scala
route: concepts/server-session-window-pane
title: Server, session, window, pane
description: Traverse captured Scala handles, retain IDs and refresh after changes.
sidebar:
  label: Server, session, window, pane
  group: Concepts
  order: 2
tableOfContents: true
---

Capture a hierarchy, then read its sessions, windows and panes locally. Handles retain the state they captured; a rename does not rewrite an older handle. Use a new capture to observe later changes.

[`Server`](../../reference/io-github-libtmux-scaladsl-server/) selects the socket and owns client resources. [`Session`](../../reference/io-github-libtmux-scaladsl-session/), [`Window`](../../reference/io-github-libtmux-scaladsl-window/) and [`Pane`](../../reference/io-github-libtmux-scaladsl-pane/) hold captured state and send mutations through that server. The session list captures the hierarchy; walking its children reads that capture.

A session holds window placements; a window holds panes. A linked window can appear in several sessions, so traversal counts placements rather than necessarily distinct physical windows. Names can change; retain IDs when identifying a target.

## Setup and run

Use an empty directory on Linux with Git, tmux 3.2a or newer, and JDK 25. Save the project files and launcher below, then save any complete program on this page. Each program has its own imports and entry point.

The pinned source checkout supplies the Gradle wrapper and the library dependency.

```kotlin title="settings.gradle.kts"
rootProject.name = "connect"
includeBuild("libtmux-source") {
    dependencySubstitution {
        substitute(module("io.github.libtmux:libtmux-scala_3"))
            .using(project(":libtmux-scala"))
    }
}
```

```kotlin title="build.gradle.kts"
val example = providers.gradleProperty("example").getOrElse("Local")

plugins {
    application
    scala
}

repositories { mavenCentral() }
dependencies {
    implementation("org.scala-lang:scala3-library_3:3.9.0")
    implementation("io.github.libtmux:libtmux-scala_3:0.0.1-alpha.17-SNAPSHOT")
}
java { toolchain { languageVersion.set(JavaLanguageVersion.of(25)) } }
sourceSets.main { scala.srcDir("."); scala.include("${example}.scala") }
application { mainClass.set(example) }
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

## Walk sessions, windows and panes

Flatten the captured children and verify the fixture contains two of each. The program also prints each session and its window.

```scala title="Hierarchy.scala"
import io.github.libtmux.{ServerConfig, ServerEndpoint}
import io.github.libtmux.scaladsl.*
import io.github.libtmux.scaladsl.query.*
import java.nio.file.Path
import java.time.Duration
import scala.util.Using
import scala.jdk.CollectionConverters.*

object Hierarchy {
  def main(args: Array[String]): Unit = {
    val socket = sys.env.getOrElse("LIBTMUX_SOCKET_PATH",
      throw new IllegalArgumentException("Set LIBTMUX_SOCKET_PATH to an existing socket"))
    val config = ServerConfig.builder()
      .endpoint(ServerEndpoint.socketPath(Path.of(socket)))
      .defaultTimeout(Duration.ofSeconds(5))
      .build()
    Using.resource(Server.open(config)) { server =>
      val sessions = server.sessions()
      val windows = sessions.flatMap(_.windows)
      val panes = windows.flatMap(_.panes)
      assert(sessions.size == 2 && windows.size == 2 && panes.size == 2)
      for (session <- sessions) {
        println(s"${session.name}: ${session.windows.head.name}")
      }
      println("2 sessions, 2 windows, 2 panes")
    }
  }
}
```

```console
$ sh run.sh ./libtmux-source/gradlew --project-dir . run \
  -Pexample=Hierarchy --console=plain --max-workers=2
```

Expected program output:

```text
work-one: editor
work-two: logs
2 sessions, 2 windows, 2 panes
```

## Observe a rename with a fresh read

Rename the editor window. The old handle still says `editor`; the returned handle and a new server read say `renamed`. This distinction matters when a UI, another client or your own code changes tmux after a capture.

```scala title="Refresh.scala"
import io.github.libtmux.{ServerConfig, ServerEndpoint}
import io.github.libtmux.scaladsl.*
import io.github.libtmux.scaladsl.query.*
import java.nio.file.Path
import java.time.Duration
import scala.util.Using
import scala.jdk.CollectionConverters.*

object Refresh {
  def main(args: Array[String]): Unit = {
    val socket = sys.env.getOrElse("LIBTMUX_SOCKET_PATH",
      throw new IllegalArgumentException("Set LIBTMUX_SOCKET_PATH to an existing socket"))
    val config = ServerConfig.builder()
      .endpoint(ServerEndpoint.socketPath(Path.of(socket)))
      .defaultTimeout(Duration.ofSeconds(5))
      .build()
    Using.resource(Server.open(config)) { server =>
      val session = server.sessions().find(_.name == "work-one").get
      val before = session.windows.head
      val after = before.rename("renamed")
      assert(before.name == "editor")
      assert(after.name == "renamed")
      val readAgain = server.sessions().find(_.name == "work-one").get.windows.head
      assert(readAgain.name == "renamed")
      println(s"${before.name} -> ${readAgain.name}")
    }
  }
}
```

```console
$ sh run.sh ./libtmux-source/gradlew --project-dir . run \
  -Pexample=Refresh --console=plain --max-workers=2
```

Expected program output:

```text
editor -> renamed
```

## Select a target before changing it

A successful lookup does not reserve a tmux object. Another client can remove it before your next command. Handle a command failure at the mutation, and refresh before deciding what to do next. See [filtering and queries](../queries/) for missing and ambiguous selections, and [layouts](../workspaces/) for creation.
