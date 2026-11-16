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

## Run a bounded command and inspect its result

Read the session list and filter it locally. The connection uses a five-second timeout so an unavailable server fails visibly.

```scala title="Local.scala"
import io.github.libtmux.{ServerConfig, ServerEndpoint, SessionSpec}
import io.github.libtmux.scaladsl.*
import io.github.libtmux.scaladsl.query.*
import java.nio.file.{Files, Path}
import java.time.Duration
import scala.util.Using
import scala.jdk.CollectionConverters.*

object Local {
  def demonstrate(server: Server): Unit = {
    val sessions = server.sessions()
    val matching = sessions.matching(Session.name.startsWith("work-"))
    val names = matching.map(_.name).sorted
    assert(names == Vector("work-one", "work-two"))
    println(names.mkString(", "))
    // Filtering the captured vector makes no new tmux calls.
    assert(sessions.filter(_.name.startsWith("work-")) == matching)
    val onlyOne = Session.name.startsWith("work-") &&
      Session.name.endsWith("one")
    assert(sessions.matching(onlyOne).head.name == "work-one")
    val either = Session.name.is("work-one") || Session.name.is("work-two")
    assert(sessions.matching(either).size == 2)
    val others = sessions.matching(!Session.name.is("work-one"))
    assert(others.head.name == "work-two")
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
$ gradle --console=plain --no-daemon run -Pexample=Local
```

Expected program output:

```text
work-one, work-two
```

## Open and close a control client

Send `list-sessions` over a persistent control connection, verify the response, then close the control client. A subsequent ordinary read verifies the tmux server still has both sessions. Managed control needs tmux 3.7 or newer; on an older server the library refuses it with an unsupported-feature error.

```scala title="Control.scala"
import io.github.libtmux.{ServerConfig, ServerEndpoint, SessionSpec}
import io.github.libtmux.scaladsl.*
import io.github.libtmux.scaladsl.query.*
import java.nio.file.{Files, Path}
import java.time.Duration
import scala.util.Using
import scala.jdk.CollectionConverters.*

object Control {
  def demonstrate(server: Server): Unit = {
    val session = server.sessions().find(_.name == "work-one").get
    Using.resource(server.control(session)) { control =>
      val reply = control.send("list-sessions", "-F", "#{session_name}")
      require(reply.succeeded(),
        s"tmux rejected list-sessions: ${reply.outcome()}")
      val names = reply.lines().asScala.toVector.sorted
      assert(names == Vector("work-one", "work-two"))
      println(names.mkString(", "))
    }
    assert(server.sessions().size == 2)
    println("control client closed; server still running")
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
$ gradle --console=plain --no-daemon run -Pexample=Control
```

Expected program output:

```text
work-one, work-two
control client closed; server still running
```

## Timeouts and ownership

An operation that times out may already have reached tmux. Read the current state before retrying a mutation such as creating a window. A cancellation signal does not roll back a completed tmux command.

Here each program owns the private server it starts and stops it before it exits. An application connecting to an existing server should close its own client resources and leave that server running. See [attaching to tmux](../../guides/attaching-to-tmux/) for the connection-only example.
