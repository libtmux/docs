---
title: "Workspace example gallery"
description: "Pinned YAML examples, JSON counterparts, and execution prerequisites."
port: swift
product: workspace
sidebar:
  label: "Workspace example gallery"
  group: "Examples"
  order: 31
tableOfContents: true
---

**tmuxp compatibility reference.** Examples using `tmuxp` run the Python reference. [Local CLI status](../../reference/compatibility/) describes this port's implemented coverage.

The examples below reproduce the pinned tmuxp YAML fixture corpus. Each record
links to its source and, where present, its JSON twin. They illustrate
configuration features; they are not all self-contained runnable projects.

The `minimal` fixture and several other files omit window names despite the
validator requiring them. Treat these as normalization and compatibility probes,
not a promise that every fixture passes every load path. The [installation
walkthrough](../../guides/installation/) supplies a complete runnable starting
file.

## 2-pane-synchronized

Accepted by the native parser in the 2026-09-09 audit. Optional YAML enabled; unsupported keys can be silently omitted. Full execution of this fixture was not established by the parser result.

[YAML source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/2-pane-synchronized.yaml); [JSON source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/2-pane-synchronized.json).

```yaml
session_name: 2-pane-synchronized
windows:
  - window_name: Two synchronized panes
    panes:
      - ssh server1
      - ssh server2
    options_after:
      synchronize-panes: on
```

## 2-pane-vertical

Accepted by the native parser in the 2026-09-09 audit. Optional YAML enabled; unsupported keys can be silently omitted. Full execution of this fixture was not established by the parser result.

[YAML source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/2-pane-vertical.yaml); [JSON source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/2-pane-vertical.json).

```yaml
session_name: 2-pane-vertical
windows:
  - window_name: my test window
    panes:
      - echo hello
      - echo hello
```

## 3-pane

Accepted by the native parser in the 2026-09-09 audit. Optional YAML enabled; unsupported keys can be silently omitted. Full execution of this fixture was not established by the parser result.

[YAML source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/3-pane.yaml); [JSON source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/3-pane.json).

```yaml
session_name: 3-panes
windows:
  - window_name: dev window
    layout: main-vertical
    shell_command_before:
      - cd ~/
    panes:
      - shell_command:
          - cd /var/log
          - ls -al | grep \.log
      - echo hello
      - echo hello
```

## 4-pane

Accepted by the native parser in the 2026-09-09 audit. Optional YAML enabled; unsupported keys can be silently omitted. Full execution of this fixture was not established by the parser result.

[YAML source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/4-pane.yaml); [JSON source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/4-pane.json).

```yaml
session_name: 4-pane-split
windows:
  - window_name: dev window
    layout: tiled
    shell_command_before:
      - cd ~/
    panes:
      - shell_command:
          - cd /var/log
          - ls -al | grep \.log
      - echo hello
      - echo hello
      - echo hello
```

## blank-panes

Accepted by the native parser in the 2026-09-09 audit. Optional YAML enabled; unsupported keys can be silently omitted. Full execution of this fixture was not established by the parser result.

[YAML source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/blank-panes.yaml); [JSON source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/blank-panes.json).

```yaml
session_name: Blank pane test
windows:
  # Emptiness will simply open a blank pane, if no shell_command_before.
  # All these are equivalent
  - window_name: Blank pane test
    panes:
      -
      - pane
      - blank
  - window_name: More blank panes
    panes:
      - null
      - shell_command:
      - shell_command:
          -
  # an empty string will be treated as a carriage return
  - window_name: Empty string (return)
    panes:
      - ""
      - shell_command: ""
      - shell_command:
          - ""
  # a pane can have other options but still be blank
  - window_name: Blank with options
    panes:
      - focus: true
      - start_directory: /tmp
```

## env-variables

Accepted by the native parser in the 2026-09-09 audit. Optional YAML enabled; unsupported keys can be silently omitted. Full execution of this fixture was not established by the parser result.

[YAML source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/env-variables.yaml); [JSON source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/env-variables.json).

```yaml
start_directory: "${PWD}/test"
shell_command_before: "echo ${PWD}"
before_script: "${MY_ENV_VAR}/test3.sh"
session_name: session - ${USER} (${MY_ENV_VAR})
windows:
  - window_name: editor
    panes:
      - shell_command:
          - tail -F /var/log/syslog
    start_directory: /var/log
  - window_name: logging for ${USER}
    options:
      automatic-rename: true
    panes:
      - shell_command:
          - htop
          - ls $PWD
```

## focus-window-and-panes

Accepted by the native parser in the 2026-09-09 audit. Optional YAML enabled; unsupported keys can be silently omitted. Full execution of this fixture was not established by the parser result.

[YAML source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/focus-window-and-panes.yaml); [JSON source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/focus-window-and-panes.json).

```yaml
session_name: focus
windows:
  - window_name: attached window
    focus: true
    panes:
      - shell_command:
          - echo hello
          - echo 'this pane should be selected on load'
        focus: true
      - shell_command:
          - cd /var/log
          - echo hello
  - window_name: second window
    shell_command_before: cd /var/log
    panes:
      - pane
      - shell_command:
          - echo 'this pane should be focused, when window switched to first time'
        focus: true
      - pane
```

## main-pane-height-percentage

Accepted by the native parser in the 2026-09-09 audit. Optional YAML enabled; unsupported keys can be silently omitted. Full execution of this fixture was not established by the parser result.

[YAML source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/main-pane-height-percentage.yaml); [JSON source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/main-pane-height-percentage.json).

```yaml
session_name: main-pane-height
start_directory: "~"
windows:
  - layout: main-horizontal
    options:
      main-pane-height: 67%
    panes:
      - shell_command:
          - top
        start_directory: "~"
      - shell_command:
          - echo "hey"
      - shell_command:
          - echo "moo"
    window_name: my window name
```

## main-pane-height

Accepted by the native parser in the 2026-09-09 audit. Optional YAML enabled; unsupported keys can be silently omitted. Full execution of this fixture was not established by the parser result.

[YAML source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/main-pane-height.yaml); [JSON source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/main-pane-height.json).

```yaml
session_name: main-pane-height
start_directory: "~"
windows:
  - layout: main-horizontal
    options:
      main-pane-height: 30
    panes:
      - shell_command:
          - top
        start_directory: "~"
      - shell_command:
          - echo "hey"
      - shell_command:
          - echo "moo"
    window_name: my window name
```

## minimal

Accepted by the native parser in the 2026-09-09 audit. Optional YAML enabled; unsupported keys can be silently omitted. Full execution of this fixture was not established by the parser result.

[YAML source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/minimal.yaml).

```yaml
session_name: My tmux session
windows:
  - panes:
      -
```

## options

Accepted by the native parser in the 2026-09-09 audit. Optional YAML enabled; unsupported keys can be silently omitted. Full execution of this fixture was not established by the parser result.

[YAML source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/options.yaml); [JSON source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/options.json).

```yaml
session_name: test window options
start_directory: "~"
global_options:
  default-shell: /bin/sh
  default-command: /bin/sh
options:
  main-pane-height: ${MAIN_PANE_HEIGHT} # works with env variables
windows:
  - layout: main-horizontal
    options:
      automatic-rename: on
    panes:
      - shell_command:
          - man echo
        start_directory: "~"
      - shell_command:
          - echo "hey"
      - shell_command:
          - echo "moo"
```

## pane-shell

Accepted by the native parser in the 2026-09-09 audit. Optional YAML enabled; unsupported keys can be silently omitted. Full execution of this fixture was not established by the parser result.

[YAML source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/pane-shell.yaml); [JSON source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/pane-shell.json).

```yaml
session_name: Pane shell example
windows:
  - window_name: first
    window_shell: /usr/bin/python2
    layout: even-vertical
    suppress_history: false
    options:
      remain-on-exit: true
    panes:
      - shell: /usr/bin/python3
        shell_command:
          - print('This is python 3')
      - shell: /usr/bin/vim -u none
        shell_command:
          - iAll panes have the `remain-on-exit` setting on.
          - When you exit out of the shell or application, the panes will remain.
          - Use tmux command `:kill-pane` to remove the pane.
          - Use tmux command `:respawn-pane` to restart the shell in the pane.
          - Use <Escape> and then `:q!` to get out of this vim window. :-)
      - shell_command:
          - print('Hello World 2')
      - shell: /usr/bin/top
```

## plugin-system

Accepted by the native parser in the 2026-09-09 audit. Optional YAML enabled; unsupported keys can be silently omitted. Full execution of this fixture was not established by the parser result.

[YAML source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/plugin-system.yaml); [JSON source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/plugin-system.json).

```yaml
session_name: plugin-system
plugins:
  - "tmuxp_plugin_extended_build.plugin.PluginExtendedBuild"
windows:
  - window_name: editor
    layout: tiled
    shell_command_before:
      - cd ~/
    panes:
      - shell_command:
          - cd /var/log
          - ls -al | grep *.log
      - echo "hello world"
```

## session-environment

Accepted by the native parser in the 2026-09-09 audit. Optional YAML enabled; unsupported keys can be silently omitted. Full execution of this fixture was not established by the parser result.

[YAML source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/session-environment.yaml); [JSON source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/session-environment.json).

```yaml
session_name: Environment variables test
environment:
  EDITOR: /usr/bin/vim
  DJANGO_SETTINGS_MODULE: my_app.settings.local
  SERVER_PORT: "8009"
windows:
  - window_name: Django project
    panes:
      - ./manage.py runserver 0.0.0.0:${SERVER_PORT}
  - window_name: Another Django project
    environment:
      DJANGO_SETTINGS_MODULE: my_app.settings.local
      SERVER_PORT: "8010"
    panes:
      - ./manage.py runserver 0.0.0.0:${SERVER_PORT}
      - environment:
          DJANGO_SETTINGS_MODULE: my_app.settings.local-testing
          SERVER_PORT: "8011"
        shell_command: ./manage.py runserver 0.0.0.0:${SERVER_PORT}
```

## shorthands

Accepted by the native parser in the 2026-09-09 audit. Optional YAML enabled; unsupported keys can be silently omitted. Full execution of this fixture was not established by the parser result.

[YAML source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/shorthands.yaml); [JSON source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/shorthands.json).

```yaml
session_name: shorthands
windows:
  - window_name: long form
    panes:
      - shell_command:
          - echo 'did you know'
          - echo 'you can inline'
      - shell_command: echo 'single commands'
      - echo 'for panes'
```

## skip-send-pane-level

Accepted by the native parser in the 2026-09-09 audit. Optional YAML enabled; unsupported keys can be silently omitted. Full execution of this fixture was not established by the parser result.

[YAML source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/skip-send-pane-level.yaml); [JSON source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/skip-send-pane-level.json).

```yaml
session_name: Skip command execution (pane-level)
windows:
  - panes:
      - shell_command: echo "___$((1 + 3))___"
        enter: false
      - shell_command:
          - echo "___$((1 + 3))___"\;
          - echo "___$((1 + 3))___"
        enter: false
```

## skip-send

Accepted by the native parser in the 2026-09-09 audit. Optional YAML enabled; unsupported keys can be silently omitted. Full execution of this fixture was not established by the parser result.

[YAML source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/skip-send.yaml); [JSON source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/skip-send.json).

```yaml
session_name: Skip command execution (command-level)
windows:
  - panes:
      - shell_command:
          # You can see this
          - echo "___$((11 + 1))___"
          # This is skipped
          - cmd: echo "___$((1 + 3))___"
            enter: false
```

## sleep-pane-level

Accepted by the native parser in the 2026-09-09 audit. Optional YAML enabled; unsupported keys can be silently omitted. Full execution of this fixture was not established by the parser result.

[YAML source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/sleep-pane-level.yaml); [JSON source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/sleep-pane-level.json).

```yaml
session_name: Pause / skip command execution (pane-level)
windows:
  - panes:
      - # Wait 2 seconds before sending all commands in this pane
        sleep_before: 2
        shell_command:
          - echo "___$((11 + 1))___"
          - cmd: echo "___$((1 + 3))___"
          - cmd: echo "___$((1 + 3))___"
          - cmd: echo "Stuff rendering here!"
          - cmd: echo "2 seconds later"
```

## sleep-virtualenv

Accepted by the native parser in the 2026-09-09 audit. Optional YAML enabled; unsupported keys can be silently omitted. Full execution of this fixture was not established by the parser result.

[YAML source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/sleep-virtualenv.yaml).

```yaml
session_name: virtualenv
shell_command_before:
  # - cmd: source $(poetry env info --path)/bin/activate
  # - cmd: source `pipenv --venv`/bin/activate
  - cmd: source .venv/bin/activate
    sleep_before: 1
    sleep_after: 1
windows:
  - panes:
      - shell_command:
          - ./manage.py runserver
```

## sleep

Accepted by the native parser in the 2026-09-09 audit. Optional YAML enabled; unsupported keys can be silently omitted. Full execution of this fixture was not established by the parser result.

[YAML source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/sleep.yaml); [JSON source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/sleep.json).

```yaml
session_name: Pause / skip command execution (command-level)
windows:
  - panes:
      - shell_command:
          # Executes immediately
          - echo "___$((11 + 1))___"
          # Delays before sending 2 seconds
          - cmd: echo "___$((1 + 3))___"
            sleep_before: 2
          # Executes immediately
          - cmd: echo "___$((1 + 3))___"
          # Pauses 2 seconds after
          - cmd: echo "Stuff rendering here!"
            sleep_after: 2
          # Executes after earlier commands (after 2 sec)
          - cmd: echo "2 seconds later"
```

## start-directory

Accepted by the native parser in the 2026-09-09 audit. Optional YAML enabled; unsupported keys can be silently omitted. Full execution of this fixture was not established by the parser result.

[YAML source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/start-directory.yaml); [JSON source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/start-directory.json).

```yaml
session_name: start directory
start_directory: /var/
windows:
  - window_name: should be /var/
    panes:
      - shell_command:
          - echo "\033c
          - it trickles down from session-level"
      - echo hello
  - window_name: should be /var/log
    start_directory: log
    panes:
      - shell_command:
          - echo '\033c
          - window start_directory concatenates to session start_directory
          - if it is not absolute'
      - echo hello
  - window_name: should be ~
    start_directory: "~"
    panes:
      - shell_command:
          - 'echo \\033c ~ has precedence. note: remember to quote ~ in YAML'
      - echo hello
  - window_name: should be /bin
    start_directory: /bin
    panes:
      - echo '\033c absolute paths also have precedence.'
      - echo hello
  - window_name: should be workspace file's dir

    start_directory: ./
    panes:
      - shell_command:
          - echo '\033c
          - ./ is relative to workspace file location
          - ../ will be parent of workspace file
          - ./test will be \"test\" dir inside dir of workspace file'
      - shell_command:
          - echo '\033c
          - This way you can load up workspaces from projects and maintain
          - relative paths.'
```

## suppress-history

Accepted by the native parser in the 2026-09-09 audit. Optional YAML enabled; unsupported keys can be silently omitted. Full execution of this fixture was not established by the parser result.

[YAML source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/suppress-history.yaml); [JSON source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/suppress-history.json).

```yaml
session_name: suppress
suppress_history: false
windows:
  - window_name: appended
    focus: true
    suppress_history: false
    panes:
      - echo "window in the history!"

  - window_name: suppressed
    suppress_history: true
    panes:
      - echo "window not in the history!"

  - window_name: default
    panes:
      - echo "session in the history!"

  - window_name: mixed
    suppress_history: false
    panes:
      - shell_command:
          - echo "command in the history!"
        suppress_history: false
      - shell_command:
          - echo "command not in the history!"
        suppress_history: true
      - shell_command:
          - echo "window in the history!"
```

## window-index

Accepted by the native parser in the 2026-09-09 audit. Optional YAML enabled; unsupported keys can be silently omitted. Full execution of this fixture was not established by the parser result.

[YAML source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/window-index.yaml); [JSON source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/examples/window-index.json).

```yaml
session_name: Window index example
windows:
  - window_name: zero
    panes:
      - echo "this window's index will be zero"
  - window_name: five
    panes:
      - echo "this window's index will be five"
    window_index: 5
  - window_name: one
    panes:
      - echo "this window's index will be one"
```

## Prerequisites and portability

SSH examples need the named hosts. Django and virtualenv examples need their
project and environment. The plugin example needs its named Python plugin. Shell
paths, log directories, top, `htop`, and editors are host-specific. The
pane-shell fixture includes an obsolete Python 2 path; it is retained as
upstream evidence, not recommended installation guidance. Review
[configuration](../../configuration/),
[commands](../../configuration/commands/), and
[compatibility](../../reference/compatibility/) before adapting these fixtures.

[tmuxp reference source](https://github.com/tmux-python/tmuxp/blob/618b398acc05506d3c682906c36cdeb29dcfa1ff/src/tmuxp/cli/__init__.py).
