---
port: kotlin
route: examples/capture-pane-output
title: Capture pane output
description: Run a complete Kotlin program that captures output on an isolated tmux server.
sidebar:
  label: Capture pane output
  group: Examples
  order: 3
tableOfContents: true
---

This complete Kotlin program starts a private tmux server, sends a command,
and captures the line it prints. It includes imports, setup, and cleanup.
You need tmux and a Unix environment; no existing session is required.

## Read what's on screen

The leading newline puts the output on a fresh row. Matching the whole line
avoids mistaking the echoed command for its output.

```kotlin title="Capture.kt"
import io.github.libtmux.ServerConfig
import io.github.libtmux.ServerEndpoint
import io.github.libtmux.kotlin.capture
import io.github.libtmux.kotlin.killServer
import io.github.libtmux.kotlin.newSession
import io.github.libtmux.kotlin.sendLine
import io.github.libtmux.kotlin.withServer
import java.nio.file.Files
import java.nio.file.Path
import java.time.Duration
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout

fun main() = runBlocking {
    val root = Files.createDirectories(Path.of("/tmp/libtmux-java-dev"))
    val directory = Files.createTempDirectory(root, "capture-")
    val socket = directory.resolve("tmux.sock")
    val config = ServerConfig.builder()
        .endpoint(ServerEndpoint.socketPath(socket))
        .configFile(Path.of("/dev/null"))
        .defaultTimeout(Duration.ofSeconds(1))
        .build()
    var failure: Throwable? = null
    try {
        withServer(config) { server ->
            try {
                val session = server.newSession {
                    name = "capture"
                    running("/bin/sh")
                    env("ENV", "/dev/null")
                }
                val pane = session.windows.first().panes.first()
                pane.sendLine("printf '\\nlibtmux capture ready\\n'")
                withTimeout(5_000) {
                    while (!pane.capture().contains("libtmux capture ready")) {
                        delay(25)
                    }
                }
                println("libtmux capture ready")
            } catch (error: Throwable) {
                failure = error
                throw error
            } finally {
                withContext(NonCancellable) {
                    try {
                        if (Files.exists(socket)) server.killServer()
                        Files.deleteIfExists(socket)
                        Files.delete(directory)
                    } catch (cleanup: Throwable) {
                        val original = failure
                        if (original == null) throw cleanup
                        original.addSuppressed(cleanup)
                    }
                }
            }
        }
    } finally {
        // Opening a client can fail before the cleanup block is entered.
        if (!Files.exists(socket)) Files.deleteIfExists(directory)
    }
}
```

<a id="wait-for-text-instead-of-guessing-a-delay"></a>

## Wait for output or completion

Capture and input calls suspend. `withTimeout` bounds the polling loop, and `delay` yields between captures. `withServer` closes the client; the `finally` block also stops the tmux server this program created. Cleanup errors stay visible, and a server that cannot be stopped keeps its socket.

Capture reads screen state and scrollback, so output that has scrolled away
may be absent. The program prints `libtmux capture ready` when its check passes
and exits unsuccessfully if an operation fails.

## Setup and run

Use an empty directory and save the files using the displayed names. You need
JDK 25. The pinned repository supplies Gradle; the project files select Kotlin 2.4.10 and include the library build.

Save `settings.gradle.kts` beside `Capture.kt`.

```kotlin title="settings.gradle.kts"
rootProject.name = "capture"
includeBuild("libtmux-source")
```

Save `build.gradle.kts` beside `Capture.kt`.

```kotlin title="build.gradle.kts"
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
    sourceSets.main { kotlin.srcDir("."); kotlin.include("Capture.kt") }
}
application { mainClass.set("CaptureKt") }
```

Save `gradle.properties` beside `Capture.kt`.

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
