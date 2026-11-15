---
title: Examples
description: Tested Kotlin examples against an isolated tmux server.
port: kotlin
route: examples
sidebar:
  group: Examples
  order: 1
---

Start with [Capture pane output](./capture-pane-output/) for a standalone program with imports, Gradle files, and private-server cleanup.

## Read a Flow

Read pushed pane output as a coroutine Flow and cancel a pending wait. The program starts a private tmux server, so it never touches a server you already run, and stops that server before it exits. It opens a managed control connection, which needs tmux 3.7 or newer. [Setup and run](#setup-and-run) lists what to install.

```kotlin title="WatchWithFlow.kt"
import io.github.libtmux.ServerConfig
import io.github.libtmux.ServerEndpoint
import io.github.libtmux.control.Delivery
import io.github.libtmux.kotlin.Server
import io.github.libtmux.kotlin.Session
import io.github.libtmux.kotlin.await
import io.github.libtmux.kotlin.killServer
import io.github.libtmux.kotlin.newSession
import io.github.libtmux.kotlin.send
import io.github.libtmux.kotlin.withControl
import io.github.libtmux.kotlin.withServer
import java.nio.file.Path
import java.time.Duration
import java.util.UUID
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.time.Duration.Companion.milliseconds
import kotlin.time.Duration.Companion.seconds

fun main() = runBlocking {
    val config = ServerConfig.builder()
        .endpoint(ServerEndpoint.namedSocket("libtmux-${UUID.randomUUID()}"))
        .configFile(Path.of("/dev/null"))
        .defaultTimeout(Duration.ofSeconds(5))
        .build()
    withServer(config) { server ->
        try {
            val session = server.newSession {
                name = "watch"
                running("/bin/sh")
                env("ENV", "/dev/null")
            }
            watch(server, session)
        } finally {
            withContext(NonCancellable) { server.killServer() }
        }
    }
}

suspend fun watch(server: Server, session: Session) =
    withControl(server, session) { control ->
        // output(...) is a cold Flow: the subscription it opens on first
        // collection closes when collection ends, is cancelled, or throws.
        // The command goes in onSubscribed: sent before collecting, its
        // output could arrive before there was a subscription to hold it.
        val seen = StringBuilder()
        val echoed = withTimeoutOrNull(10.seconds) {
            control.output(capacity = 32) {
                control.send(
                    "send-keys", "-t", session.name, "echo flowed", "Enter"
                )
            }.map { Delivery.kept(it).data }.first { chunk ->
                seen.append(chunk)
                printed(seen.toString(), "flowed")
            }
        } != null
        println("echoed=$echoed")

        // Cancelling a wait ends its coroutine at once; it is not a timeout.
        val cancelled = withTimeoutOrNull(200.milliseconds) {
            server.channel("never-signalled").await(30.seconds)
        } == null
        println("cancelled=$cancelled")
    }

// A shell can put escape sequences before a printed line, so strip them.
private fun printed(output: String, text: String): Boolean =
    output.lines().any { line ->
        line.replace(Regex("\u001B\\[[0-9;?]*[A-Za-z]"), "").trim() == text
    }
```

## Setup and run

Use an empty directory with JDK 25, Gradle 9 and tmux 3.7 or newer, which the managed control connection needs. The project files select Kotlin 2.4.10 and install `libtmux-kotlin` 0.1.2 from Maven Central ([source](https://github.com/libtmux/libtmux-java/tree/e8a39689d8d60968ac978a1dd2a89c6112333896/libtmux-kotlin)). Save the program as `WatchWithFlow.kt` and these files beside it:

```kotlin title="settings.gradle.kts"
rootProject.name = "watch"
```

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
    sourceSets.main { kotlin.srcDir("."); kotlin.include("WatchWithFlow.kt") }
}
application { mainClass.set("WatchWithFlowKt") }
```

```properties title="gradle.properties"
org.gradle.jvmargs=-Xmx2g -XX:MaxMetaspaceSize=768m -Dfile.encoding=UTF-8
kotlin.daemon.jvmargs=-Xmx2g
org.gradle.workers.max=2
```

```console
$ gradle --console=plain --no-daemon run
```

Expected program output:

```text
echoed=true
cancelled=true
```
