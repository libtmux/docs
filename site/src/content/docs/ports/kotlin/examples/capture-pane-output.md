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
You need tmux 3.3a or newer and a Unix environment; no existing session is
required.

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
    val directory = Files.createTempDirectory("libtmux-capture-")
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
JDK 25 and Gradle 9. The project files select Kotlin 2.4.10 and install
`libtmux-kotlin` 0.1.2 from Maven Central.

Save `settings.gradle.kts` beside `Capture.kt`.

```kotlin title="settings.gradle.kts"
rootProject.name = "capture"
```

Save `build.gradle.kts` beside `Capture.kt`.

```kotlin title="build.gradle.kts"
plugins {
    application
    kotlin("jvm") version "2.4.10"
}

repositories { mavenCentral() }
dependencies {
    implementation("io.github.libtmux:libtmux-kotlin:0.1.2")
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

Build and run the program:

```console
$ gradle --console=plain --no-daemon run
```

<a id="source-inclusion"></a>

## Where this comes from

This program uses `libtmux-kotlin` 0.1.2 from Maven Central. Its
[source](https://github.com/libtmux/libtmux-java/tree/e8a39689d8d60968ac978a1dd2a89c6112333896/libtmux-kotlin)
is on GitHub.
