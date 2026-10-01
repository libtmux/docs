---
port: scala
route: examples/capture-pane-output
title: Capture pane output
description: Run a complete Scala program that captures output on an isolated tmux server.
sidebar:
  label: Capture pane output
  group: Examples
  order: 3
tableOfContents: true
---

This complete Scala program starts a private tmux server, sends a command,
and captures the line it prints. It includes imports, setup, and cleanup.
You need tmux and a Unix environment; no existing session is required.

## Read what's on screen

The leading newline puts the output on a fresh row. Matching the whole line
avoids mistaking the echoed command for its output.

```scala title="Capture.scala"
import io.github.libtmux.{ServerConfig, ServerEndpoint, SessionSpec}
import io.github.libtmux.scaladsl.*
import java.nio.file.{Files, Path}
import java.time.Duration
import scala.util.Using

object Capture {
  def main(args: Array[String]): Unit = {
    val root = Files.createDirectories(Path.of("/tmp/libtmux-java-dev"))
    val directory = Files.createTempDirectory(root, "capture-")
    val socket = directory.resolve("tmux.sock")
    val config = ServerConfig.builder()
      .endpoint(ServerEndpoint.socketPath(socket))
      .configFile(Path.of("/dev/null"))
      .defaultTimeout(Duration.ofSeconds(1))
      .build()
    var failure: Option[Throwable] = None
    try {
      Using.resource(Server.open(config)) { server =>
        try {
          val session = server.newSession(SessionSpec.builder()
            .named("capture").running("/bin/sh").env("ENV", "/dev/null").build())
          val pane = session.windows.head.panes.head
          pane.sendLine("printf '\\nlibtmux capture ready\\n'")
          val deadline = System.nanoTime() + Duration.ofSeconds(5).toNanos
          var captured = false
          while (!captured && System.nanoTime() < deadline) {
            captured = pane.capture().contains("libtmux capture ready")
            if (!captured) Thread.sleep(25)
          }
          if (!captured)
            throw new IllegalStateException("Output did not arrive within five seconds")
          println("libtmux capture ready")
        } catch {
          case error: Throwable =>
            failure = Some(error)
            throw error
        } finally {
          try {
            if (Files.exists(socket)) server.killServer()
            Files.deleteIfExists(socket)
            Files.delete(directory)
          } catch {
            case cleanup: Throwable => failure match {
              case Some(original) => original.addSuppressed(cleanup)
              case None => throw cleanup
            }
          }
        }
      }
    } finally {
      // Opening a client can fail before the cleanup block is entered.
      if (!Files.exists(socket)) Files.deleteIfExists(directory)
    }
  }
}
```

<a id="wait-for-text-instead-of-guessing-a-delay"></a>

## Wait for output or completion

The Scala facade uses blocking calls. The loop checks complete captured lines against a monotonic deadline. [`Using.resource`](https://www.scala-lang.org/api/3.x/scala/util/Using$.html) closes the client; the `finally` block also stops the tmux server this program created. Cleanup errors stay visible, and a server that cannot be stopped keeps its socket.

Capture reads screen state and scrollback, so output that has scrolled away
may be absent. The program prints `libtmux capture ready` when its check passes
and exits unsuccessfully if an operation fails.

## Setup and run

Use an empty directory and save the files using the displayed names. You need
JDK 25. The pinned repository supplies Gradle; the project files select Scala 3.9.0 and include the library build.

Save `settings.gradle.kts` beside `Capture.scala`.

```kotlin title="settings.gradle.kts"
rootProject.name = "capture"
includeBuild("libtmux-source") {
    dependencySubstitution {
        substitute(module("io.github.libtmux:libtmux-scala_3"))
            .using(project(":libtmux-scala"))
    }
}
```

Save `build.gradle.kts` beside `Capture.scala`.

```kotlin title="build.gradle.kts"
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
sourceSets.main { scala.srcDir("."); scala.include("Capture.scala") }
application { mainClass.set("Capture") }
```

Save `gradle.properties` beside `Capture.scala`.

```properties title="gradle.properties"
org.gradle.jvmargs=-Xmx2g -XX:MaxMetaspaceSize=768m -Dfile.encoding=UTF-8
kotlin.daemon.jvmargs=-Xmx2g
org.gradle.workers.max=2
```

The commands pin the library revision used to run this program.

```console
$ git clone https://github.com/libtmux/libtmux-java libtmux-source &&
  git -C libtmux-source checkout 85ebf6955e56703c5be74e2afd34a18309044741 &&
  ./libtmux-source/gradlew --project-dir . run --console=plain --max-workers=2
```

<a id="source-inclusion"></a>

## Where this comes from

The displayed files were compiled or loaded with their native tools and run
on Linux with tmux 3.2a and 3.7c. The rendering checks preserve those file bytes.
