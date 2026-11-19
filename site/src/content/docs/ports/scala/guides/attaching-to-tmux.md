---
port: scala
route: guides/attaching-to-tmux
title: Attaching to tmux
description: Connect to an existing tmux server and find a session with Scala.
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

Save the complete program as `Connect.scala`. When `LIBTMUX_SOCKET_PATH` names
the socket of a running server, `printWork` opens a new `Server` handle on that
socket and finds the `work` session. The program leaves that server running.

Without the variable, the program starts a private server with a `work` session
running `cat`, reads it through a separate handle in the same way, and then
stops the server it started and removes its socket directory. If that server
cannot be stopped, the program reports the retained directory and exits with
an error.

```scala title="Connect.scala"
import io.github.libtmux.{ServerConfig, ServerEndpoint, SessionSpec}
import io.github.libtmux.scaladsl.*
import java.nio.file.{Files, Path}
import java.time.Duration
import scala.util.Using

object Connect {
  def main(args: Array[String]): Unit =
    sys.env.get("LIBTMUX_SOCKET_PATH") match {
      case Some(existing) => printWork(Path.of(existing))
      case None => demonstrate()
    }

  // A new Server handle reaches a running server through its socket path.
  def printWork(socket: Path): Unit = {
    val config = ServerConfig.builder()
      .endpoint(ServerEndpoint.socketPath(socket))
      .defaultTimeout(Duration.ofSeconds(5))
      .build()
    Using.resource(Server.open(config)) { server =>
      val session = server.sessions().find(_.name == "work").getOrElse(
        throw new IllegalStateException("The work session does not exist"))
      println(session.name)
    }
  }

  // Without LIBTMUX_SOCKET_PATH, start a private server to attach to.
  def demonstrate(): Unit = {
    val directory = Files.createTempDirectory("libtmux-attach-")
    val socket = directory.resolve("tmux.sock")
    val config = ServerConfig.builder()
      .endpoint(ServerEndpoint.socketPath(socket))
      .configFile(Path.of("/dev/null"))
      .defaultTimeout(Duration.ofSeconds(5))
      .build()
    var stopped = false
    try {
      Using.resource(Server.open(config)) { owner =>
        try {
          owner.newSession(SessionSpec.builder().named("work").running("/bin/cat").build())
          printWork(socket)
        } finally {
          if (Files.exists(socket)) owner.killServer()
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

## Setup and run

Use an empty directory on Linux with tmux 3.3a or newer, JDK 25 and Gradle 9.
The build file installs `libtmux-scala_3` 0.1.2 from Maven Central
([source](https://github.com/libtmux/libtmux-java/tree/e8a39689d8d60968ac978a1dd2a89c6112333896/libtmux-scala)).

This example was checked with JDK 25.0.3, Gradle 9.7.0 and Scala 3.9.0.

Save this file beside the program using the displayed filename.

```kotlin title="build.gradle.kts"
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
sourceSets.main { scala.srcDir("."); scala.include("Connect.scala") }
application { mainClass.set("Connect") }
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
