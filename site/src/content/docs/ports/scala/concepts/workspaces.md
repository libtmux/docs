---
port: scala
route: concepts/workspaces
title: Layouts and repeated setup
description: Create and reuse Scala tmux layouts while preserving running processes.
sidebar:
  label: Layouts and repeated setup
  group: Concepts
  order: 6
tableOfContents: true
---

Build a tmux layout from Scala by creating a window, splitting a pane and selecting a layout. Capture again to inspect the result. The examples use the library APIs directly and give every pane a command that stays alive.

## Setup and run

Use an empty directory on Linux with tmux 3.3a or newer, JDK 25, and Gradle 9. Save the project files below, then save any complete program on this page. Each program has its own imports and entry point.

Gradle resolves `libtmux-scala_3` 0.1.2 from Maven Central ([source](https://github.com/libtmux/libtmux-java/tree/e8a39689d8d60968ac978a1dd2a89c6112333896/libtmux-scala)).

```kotlin title="settings.gradle.kts"
rootProject.name = "connect"
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
    implementation("io.github.libtmux:libtmux-scala_3:0.1.2")
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

Each program starts its own private tmux server with two sessions: `work-one` with an `editor` window, and `work-two` with a `logs` window. Each pane runs `cat` so it stays alive. The program stops only that server when it finishes or fails, then removes the server's directory. If shutdown fails, it reports the retained directory and exits with an error.

Each run starts from the same two-session fixture. Programs do not depend on another example having run first. Their assertions fail if the observed result differs.

## Create a two-pane tools window

Create `tools` in `work-one`, split its pane to the right, then choose `even-horizontal`. The final read verifies two panes. The previously captured session does not automatically gain the new window.

```scala title="Layout.scala"
import io.github.libtmux.{ServerConfig, ServerEndpoint, SessionSpec}
import io.github.libtmux.scaladsl.*
import io.github.libtmux.scaladsl.query.*
import java.nio.file.{Files, Path}
import java.time.Duration
import scala.util.Using
import scala.jdk.CollectionConverters.*

object Layout {
  def demonstrate(server: Server): Unit = {
    val session = server.sessions().find(_.name == "work-one").get
    val window = session.newWindow(io.github.libtmux.WindowSpec.builder()
      .named("tools").running("/bin/cat").build())
    window.panes.head.split(io.github.libtmux.SplitSpec.builder()
      .toRight().running("/bin/cat").build())
    window.selectLayout(io.github.libtmux.Layout.EVEN_HORIZONTAL)
    val refreshed = server.sessions().find(_.name == "work-one").get
    val tools = refreshed.windows.find(_.name == "tools").get
    assert(tools.panes.size == 2)
    println("tools: 2 panes")
  }

  def main(args: Array[String]): Unit = {
    val directory = Files.createTempDirectory("libtmux-example-")
    val socket = directory.resolve("tmux.sock")
    val config = ServerConfig.builder()
      .endpoint(ServerEndpoint.socketPath(socket))
      .configFile(Path.of("/dev/null"))
      .defaultTimeout(Duration.ofSeconds(5))
      .build()
    var stopped = false
    try {
      Using.resource(Server.open(config)) { server =>
        try {
          server.newSession(SessionSpec.builder()
            .named("work-one").firstWindowNamed("editor")
            .running("/bin/cat").build())
          server.newSession(SessionSpec.builder()
            .named("work-two").firstWindowNamed("logs")
            .running("/bin/cat").build())
          demonstrate(server)
        } finally {
          if (Files.exists(socket)) server.killServer()
          stopped = true
        }
      }
    } finally {
      if (stopped || !Files.exists(socket)) {
        Files.deleteIfExists(socket)
        Files.delete(directory)
      } else {
        System.err.println(s"Cannot stop tmux; kept $directory")
      }
    }
  }
}
```

```console
$ gradle --console=plain --no-daemon run -Pexample=Layout
```

Expected program output:

```text
tools: 2 panes
```

## Reuse a named window

Look for `tools` before creating it. Two sequential calls return the same window ID, and the session has only `editor` and `tools`. This is useful for a setup command you run repeatedly.

```scala title="ReuseLayout.scala"
import io.github.libtmux.{ServerConfig, ServerEndpoint, SessionSpec}
import io.github.libtmux.scaladsl.*
import io.github.libtmux.scaladsl.query.*
import java.nio.file.{Files, Path}
import java.time.Duration
import scala.util.Using
import scala.jdk.CollectionConverters.*

object ReuseLayout {
  def demonstrate(server: Server): Unit = {
    def ensureTools(): Window = {
      val session = server.sessions().find(_.name == "work-one").get
      session.windows.find(_.name == "tools").getOrElse {
        session.newWindow(io.github.libtmux.WindowSpec.builder()
          .named("tools").running("/bin/cat").build())
      }
    }
    val first = ensureTools()
    val second = ensureTools()
    assert(first.id == second.id)
    val session = server.sessions().find(_.name == "work-one").get
    assert(session.windows.size == 2)
    println("one tools window after two calls")
  }

  def main(args: Array[String]): Unit = {
    val directory = Files.createTempDirectory("libtmux-example-")
    val socket = directory.resolve("tmux.sock")
    val config = ServerConfig.builder()
      .endpoint(ServerEndpoint.socketPath(socket))
      .configFile(Path.of("/dev/null"))
      .defaultTimeout(Duration.ofSeconds(5))
      .build()
    var stopped = false
    try {
      Using.resource(Server.open(config)) { server =>
        try {
          server.newSession(SessionSpec.builder()
            .named("work-one").firstWindowNamed("editor")
            .running("/bin/cat").build())
          server.newSession(SessionSpec.builder()
            .named("work-two").firstWindowNamed("logs")
            .running("/bin/cat").build())
          demonstrate(server)
        } finally {
          if (Files.exists(socket)) server.killServer()
          stopped = true
        }
      }
    } finally {
      if (stopped || !Files.exists(socket)) {
        Files.deleteIfExists(socket)
        Files.delete(directory)
      } else {
        System.err.println(s"Cannot stop tmux; kept $directory")
      }
    }
  }
}
```

```console
$ gradle --console=plain --no-daemon run -Pexample=ReuseLayout
```

Expected program output:

```text
one tools window after two calls
```

## Decide what repeated setup means

The reuse example preserves the existing window and its running processes. It does not reset its pane count, layout or commands. Choose that policy deliberately when building a reusable workspace command.

This check-then-create sequence assumes one writer. Concurrent callers can both observe an absent window and create duplicates. Serialize setup in your application when several callers share a session. A later failure also leaves earlier successful mutations in place; tmux commands are not a transaction.

Use [filtering and queries](../queries/) for stricter target selection and [captured handles](../server-session-window-pane/) to understand refresh behavior.
