---
port: scala
route: concepts/transports
title: Commands and control mode
description: Use Scala command calls and persistent control connections with explicit cleanup.
sidebar:
  label: Commands and control mode
  group: Concepts
  order: 5
tableOfContents: true
---

Choose command calls for bounded operations and a control connection when you need a persistent tmux client. Closing a client releases its resources; it does not mean the tmux server should be stopped.

The direct [`Server`](../../reference/io-github-libtmux-scaladsl-server/) API blocks until the operation completes. `Using.resource` closes its client resources. For effectful applications, the [execution guide](../../guides/execution/) covers the Cats Effect and Ox packages.

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

## Run a bounded command and inspect its result

Read the session list and filter it locally. The connection uses a five-second timeout so an unavailable server fails visibly.

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

## Open and close a control client

Send `list-sessions` over a persistent control connection, verify the response, then close the control client. A subsequent ordinary read verifies the tmux server still has both sessions.

```scala title="Control.scala"
import io.github.libtmux.{ServerConfig, ServerEndpoint}
import io.github.libtmux.scaladsl.*
import io.github.libtmux.scaladsl.query.*
import java.nio.file.Path
import java.time.Duration
import scala.util.Using
import scala.jdk.CollectionConverters.*

object Control {
  def main(args: Array[String]): Unit = {
    val socket = sys.env.getOrElse("LIBTMUX_SOCKET_PATH",
      throw new IllegalArgumentException(
        "Set LIBTMUX_SOCKET_PATH to an existing socket"))
    val config = ServerConfig.builder()
      .endpoint(ServerEndpoint.socketPath(Path.of(socket)))
      .defaultTimeout(Duration.ofSeconds(5))
      .build()
    Using.resource(Server.open(config)) { server =>
      val session = server.sessions().find(_.name == "work-one").get
      Using.resource(server.control(session)) { control =>
        val reply = control.send("list-sessions", "-F", "#{session_name}")
        require(
          reply.succeeded(),
          s"tmux rejected list-sessions: ${reply.outcome()}")
        val names = reply.lines().asScala.toVector.sorted
        assert(names == Vector("work-one", "work-two"))
        println(names.mkString(", "))
      }
      assert(server.sessions().size == 2)
      println("control client closed; server still running")
    }
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
