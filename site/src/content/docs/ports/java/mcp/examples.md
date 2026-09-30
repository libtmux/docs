---
title: Java MCP examples
description: Connect a Java MCP client and inspect a private tmux session.
port: java
product: mcp
sidebar:
  label: Examples
  order: 3
---

Create a private tmux session, launch the Java MCP server, and call
[`list_sessions`](../tools/list_sessions/) through the Java SDK client. The
program checks the result and closes both the MCP process and tmux server.
For a client configured to launch the server itself, use the
[connection guide](../guides/).

<a id="internals"></a>
<a id="supply-a-transport"></a>

## Create the project

Use JDK 25, Git, tmux 3.2a or newer, and a Unix host with `env -u`. Create an
empty project and fetch the source revision used by this example:

```console
$ mkdir java-mcp-example && cd java-mcp-example && \
    git init libtmux-source && \
    git -C libtmux-source remote add origin https://github.com/libtmux/libtmux-java.git && \
    git -C libtmux-source fetch --depth=1 origin 842228310449e879ebcaa3f910597757c9dbffd6 && \
    git -C libtmux-source checkout --detach FETCH_HEAD && \
    mkdir -p src/main/java
```

Save the settings file. The included build supplies the MCP and core libraries
from the same selected source. Its toolchain resolver downloads the Temurin 21
compiler for those libraries when needed.

```kotlin title="settings.gradle.kts"
rootProject.name = "mcp-example"
includeBuild("libtmux-source")
```

Save the build file. Its SDK and JSON dependencies match the selected library:

```kotlin title="build.gradle.kts"
plugins {
    application
}

repositories {
    mavenCentral()
}

dependencies {
    implementation("io.github.libtmux:libtmux-mcp:0.0.1-alpha.12-SNAPSHOT")
    implementation("io.modelcontextprotocol.sdk:mcp-json-jackson2:2.0.1")
    implementation("com.fasterxml.jackson.core:jackson-databind:2.21.5")
    runtimeOnly("org.slf4j:slf4j-nop:2.0.17")
}

java {
    toolchain.languageVersion.set(JavaLanguageVersion.of(25))
}

application {
    mainClass.set("McpExample")
}
```

## List sessions

Save the complete program below. The socket name is unique to this run.
Cleanup is registered before creating the session, so it also covers a
failure after tmux has started. Java retains cleanup failures as suppressed
exceptions when an operation has already failed.

```java title="src/main/java/McpExample.java"
import com.fasterxml.jackson.databind.ObjectMapper;
import io.github.libtmux.Server;
import io.github.libtmux.ServerEndpoint;
import io.modelcontextprotocol.client.McpClient;
import io.modelcontextprotocol.client.transport.ServerParameters;
import io.modelcontextprotocol.client.transport.StdioClientTransport;
import io.modelcontextprotocol.json.jackson2.JacksonMcpJsonMapper;
import io.modelcontextprotocol.spec.McpSchema;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public final class McpExample {
    public static void main(String[] args) throws Exception {
        String socket = "mcp-example-" + UUID.randomUUID();
        try (Server server = Server.builder()
                .endpoint(ServerEndpoint.namedSocket(socket))
                .configFile(Path.of("/dev/null"))
                .defaultTimeout(Duration.ofSeconds(5))
                .build();
                AutoCloseable stopTmux = server::killServer) {
            server.newSession(session -> session.named("mcp-example")
                    .running("/bin/cat", "-u"));
            var launcher = ServerParameters.builder("env")
                    .args("-u", "TMUX", "-u", "TMUX_PANE",
                            "-u", "LIBTMUX_EXCLUDE_TOOLS", "-u", "LIBTMUX_SAFETY",
                            "-u", "LIBTMUX_WATCH",
                            Path.of(System.getProperty("java.home"), "bin", "java").toString(),
                            "-classpath", System.getProperty("java.class.path"),
                            "io.github.libtmux.mcp.Main", "--socket-name", socket)
                    .env(Map.of("LIBTMUX_TOOLSETS", "", "LIBTMUX_TOOLS", "list_sessions",
                            "LIBTMUX_TMUX_CONFIG", "/dev/null"))
                    .build();
            var mapper = new ObjectMapper();
            var transport = new StdioClientTransport(launcher, new JacksonMcpJsonMapper(mapper));
            transport.setStdErrorHandler(System.err::println);
            try (var client = McpClient.sync(transport)
                    .initializationTimeout(Duration.ofSeconds(10))
                    .requestTimeout(Duration.ofSeconds(5))
                    .build()) {
                client.initialize();
                var offered = client.listTools().tools().stream()
                        .map(McpSchema.Tool::name).toList();
                if (!offered.equals(List.of("list_sessions"))) {
                    throw new IllegalStateException("Unexpected tools: " + offered);
                }
                var result = client.callTool(
                        McpSchema.CallToolRequest.builder("list_sessions").build());
                if (Boolean.TRUE.equals(result.isError())) {
                    throw new IllegalStateException("Tool failed: " + result.content());
                }
                var sessions = mapper.valueToTree(result.structuredContent()).path("sessions");
                if (sessions.size() != 1 ||
                        !sessions.get(0).path("name").asText().equals("mcp-example")) {
                    throw new IllegalStateException("Expected the example's private session");
                }
                System.out.println("tools: list_sessions");
                System.out.println("sessions: mcp-example");
            }
        }
    }
}
```

Build the application distribution:

```console
$ ./libtmux-source/gradlew --no-daemon --max-workers=2 -p . installDist
```

Run the installed application:

```console
$ ./build/install/mcp-example/bin/mcp-example
```

The application prints:

```text
tools: list_sessions
sessions: mcp-example
```

Server startup diagnostics go to stderr; stdout contains the example's result.
The client uses bounded initialization and request timeouts. It removes
inherited pane identity, tool exclusions, and retired settings from the child
process, then selects only `list_sessions` on the explicit private socket.

Check `isError` before reading structured output. The
[tool reference](../tools/list_sessions/) describes the successful response;
use its session IDs for later requests.

## Supply your own transport

An application embedding the server can pass its existing `Server` and MCP
transport to `TmuxMcpServer.serving`. Ownership of that transport transfers on
entry. The returned MCP server closes it, including during failed startup;
close the returned server when serving ends. The application still chooses
when to stop its tmux server.

## Inspect command completion

On a disposable session with the `execute` toolset enabled, use an MCP client
to discover a pane and call `run_shell_command`. Read the typed exit status
and output. Use `capture_since` for subsequent screen changes; a prompt redraw
can arrive after command completion.

[Server entry points](https://github.com/libtmux/libtmux-java/blob/842228310449e879ebcaa3f910597757c9dbffd6/libtmux-mcp/src/main/java/io/github/libtmux/mcp/TmuxMcpServer.java);
[upstream MCP tests](https://github.com/libtmux/libtmux-java/tree/842228310449e879ebcaa3f910597757c9dbffd6/libtmux-mcp/src/test).
