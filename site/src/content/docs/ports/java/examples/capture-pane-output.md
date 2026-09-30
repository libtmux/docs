---
port: java
route: examples/capture-pane-output
title: Capture pane output
description: Run a complete program that captures a pane and waits for a complete output line.
sidebar:
  label: Capture pane output
  group: Examples
  order: 3
tableOfContents: true
---

A pane runs asynchronously: sending a command does not mean its output is
already on screen. Capture repeatedly until the expected line appears, with a
deadline so a failed command cannot leave the program waiting forever.

This complete program creates a private tmux server, captures its output, and
cleans up. Follow the [setup and run instructions](#setup-and-run) below. You need
tmux and a Unix environment; no existing tmux session is required.

## Read what's on screen

The program sends `printf` with a leading newline, then waits for the complete
line `libtmux capture ready`. The newline keeps a late shell prompt off that
line. Matching the whole line avoids mistaking the echoed command for its output.

```java title="Capture.java"
import io.github.libtmux.Pane;
import io.github.libtmux.Server;
import io.github.libtmux.ServerConfig;
import io.github.libtmux.ServerEndpoint;
import io.github.libtmux.Session;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;

public final class Capture {
    public static void main(String[] args) throws Exception {
        Path directory = Files.createTempDirectory("libtmux-capture-");
        Path socket = directory.resolve("tmux.sock");
        ServerConfig config = ServerConfig.builder()
                .endpoint(ServerEndpoint.socketPath(socket))
                .configFile(Path.of("/dev/null"))
                .defaultTimeout(Duration.ofSeconds(1))
                .build();
        try (Server server = Server.open(config)) {
            try {
                Session session = server.newSession(s -> s
                        .named("capture").running("sh").env("ENV", "/dev/null"));
                Pane pane = session.windows().get(0).panes().get(0);
                pane.sendLine("printf '\\nlibtmux capture ready\\n'");
                long deadline = System.nanoTime() + Duration.ofSeconds(5).toNanos();
                while (System.nanoTime() < deadline) {
                    List<String> lines = pane.capture();
                    if (lines.contains("libtmux capture ready")) {
                        System.out.println("libtmux capture ready");
                        return;
                    }
                    Thread.sleep(20);
                }
                throw new IllegalStateException("Timed out waiting for pane output");
            } finally {
                server.killServer();
            }
        } finally {
            Files.deleteIfExists(socket);
            Files.delete(directory);
        }
    }
}
```

<a id="wait-for-text-instead-of-guessing-a-delay"></a>

## Wait for output or completion

The program above checks the captured screen for up to five seconds. The short
pause between checks limits polling; the observed output determines when the loop
finishes. A tmux capture is a view of the screen and scrollback, so it can miss
output that has already scrolled away. Use a stream or a completion signal for
long-running commands when that distinction matters.

[Capturing output](/guides/capturing-output/) covers capture options, while
[Sending keys](/guides/sending-keys/#the-race-you-cant-see-from-the-call-site)
explains why sending and waiting are separate operations.

## Setup and run

Use an empty directory. The commands pin the library
revision used to verify the program.

Save the program as `Capture.java`. Use JDK 21 or newer. The repository's Gradle
wrapper builds the library; the Java source launcher runs the complete program.

```console
$ git clone https://github.com/libtmux/libtmux-java libtmux &&
  git -C libtmux checkout 842228310449e879ebcaa3f910597757c9dbffd6 &&
  (cd libtmux && ./gradlew :libtmux:jar) &&
  java --class-path 'libtmux/libtmux/build/libs/*' Capture.java
```

<a id="source-inclusion"></a>

## Where this comes from

This complete program was run against the library revision pinned above.
The displayed code is checked against the bytes from that run.
