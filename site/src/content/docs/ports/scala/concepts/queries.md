---
port: scala
route: concepts/queries
title: Filtering and queries
description: Compose Scala filters, distinguish zero and several matches, and query captured relations.
sidebar:
  label: Filtering and queries
  group: Concepts
  order: 4
tableOfContents: true
---

Filter captured objects in Scala, handle result counts explicitly, and match sessions by their related windows. Local filters read captured values; they do not subscribe to changes or issue a fresh tmux query.

[`Expr`](../../reference/io-github-libtmux-scaladsl-query-expr-zfkn/) supports `&&`, `||` and `!`. The field companions expose equality, prefix, suffix, substring and pattern matching. Use `.matching(expression)` for a typed query or `.filter(predicate)` for an ordinary Scala condition.

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

## Match names and combine conditions

Select the two names beginning with `work-`, then assert equality, AND, OR and exclusion against the same captured collection. Matching is case sensitive. The native collection predicate agrees with the typed prefix query.

```scala title="Local.scala"
import io.github.libtmux.{ServerConfig, ServerEndpoint}
import io.github.libtmux.scaladsl.*
import io.github.libtmux.scaladsl.query.*
import java.nio.file.Path
import java.time.Duration
import scala.util.Using
import scala.jdk.CollectionConverters.*

object Local {
  def main(args: Array[String]): Unit = {
    val socket = sys.env.getOrElse("LIBTMUX_SOCKET_PATH",
      throw new IllegalArgumentException(
        "Set LIBTMUX_SOCKET_PATH to an existing socket"))
    val config = ServerConfig.builder()
      .endpoint(ServerEndpoint.socketPath(Path.of(socket)))
      .defaultTimeout(Duration.ofSeconds(5))
      .build()
    Using.resource(Server.open(config)) { server =>
      val sessions = server.sessions()
      val matching = sessions.matching(Session.name.startsWith("work-"))
      val names = matching.map(_.name).sorted
      assert(names == Vector("work-one", "work-two"))
      println(names.mkString(", "))
      // Filtering the captured vector makes no new tmux calls.
      assert(sessions.filter(_.name.startsWith("work-")) == matching)
      val endsInOne = Session.name.endsWith("one")
      val onlyOne = Session.name.startsWith("work-") && endsInOne
      assert(sessions.matching(onlyOne).head.name == "work-one")
      val either = Session.name.is("work-one") || Session.name.is("work-two")
      assert(sessions.matching(either).size == 2)
      val notOne = sessions.matching(!Session.name.is("work-one"))
      assert(notOne.head.name == "work-two")
    }
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

An exactly-one selection returns an `Either`: one handle on success, `CardinalityError.NoMatch` for zero, or `MultipleMatches` for several. An at-most-one selection also rejects ambiguity; it does not pick an arbitrary first result.

```scala title="Cardinality.scala"
import io.github.libtmux.{ServerConfig, ServerEndpoint}
import io.github.libtmux.scaladsl.*
import io.github.libtmux.scaladsl.query.*
import java.nio.file.Path
import java.time.Duration
import scala.util.Using
import scala.jdk.CollectionConverters.*

object Cardinality {
  def main(args: Array[String]): Unit = {
    val socket = sys.env.getOrElse("LIBTMUX_SOCKET_PATH",
      throw new IllegalArgumentException(
        "Set LIBTMUX_SOCKET_PATH to an existing socket"))
    val config = ServerConfig.builder()
      .endpoint(ServerEndpoint.socketPath(Path.of(socket)))
      .defaultTimeout(Duration.ofSeconds(5))
      .build()
    Using.resource(Server.open(config)) { server =>
      val sessions = server.sessions()
      for (name <- Vector("work-one", "missing")) {
        sessions.matching(Session.name.is(name)).exactlyOne match {
          case Right(session) => println(s"${session.name}: selected")
          case Left(CardinalityError.NoMatch) => println(s"$name: absent")
          case Left(CardinalityError.MultipleMatches(count)) =>
            throw new IllegalStateException(
              s"At least $count sessions named $name")
        }
      }
      val many = sessions.matching(Session.name.startsWith("work-")).atMostOne
      assert(many == Left(CardinalityError.MultipleMatches(2)))
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

```scala title="Relations.scala"
import io.github.libtmux.{ServerConfig, ServerEndpoint}
import io.github.libtmux.scaladsl.*
import io.github.libtmux.scaladsl.query.*
import java.nio.file.Path
import java.time.Duration
import scala.util.Using
import scala.jdk.CollectionConverters.*

object Relations {
  def main(args: Array[String]): Unit = {
    val socket = sys.env.getOrElse("LIBTMUX_SOCKET_PATH",
      throw new IllegalArgumentException(
        "Set LIBTMUX_SOCKET_PATH to an existing socket"))
    val config = ServerConfig.builder()
      .endpoint(ServerEndpoint.socketPath(Path.of(socket)))
      .defaultTimeout(Duration.ofSeconds(5))
      .build()
    Using.resource(Server.open(config)) { server =>
      val sessions = server.sessions()
      val editorWindow = Window.name.is("editor")
      val withEditor = sessions.matching(Session.windows.any(editorWindow))
      val withoutEditor = sessions.matching(Session.windows.none(editorWindow))
      assert(withEditor.map(_.name) == Vector("work-one"))
      assert(withoutEditor.map(_.name) == Vector("work-two"))
      println(s"editor: ${withEditor.head.name}")
      println(s"no editor: ${withoutEditor.head.name}")
    }
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
