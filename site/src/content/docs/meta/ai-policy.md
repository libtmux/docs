---
title: AI policy
description: Use the libtmux packages with AI tools. When contributing, check what you submit and wait for a maintainer's invitation before preparing a pull request.
sidebar:
  label: AI policy
  order: 98
tableOfContents: true
---

Last revised October 25, 2026

Use these packages with AI tools as you like. When contributing, check what
you submit and wait for a maintainer's invitation before preparing a pull
request.

This policy covers the libraries, ports, and documentation in the
[libtmux](https://github.com/libtmux) and
[tmux-python](https://github.com/tmux-python) organizations, including their
issues, comments, discussions, reviews, and pull requests.

## 1. For users: About these packages

We encourage you to use AI tools with our libraries and documentation,
including to generate code that calls the libraries. We want these projects to
be useful in the way you work. Some of what we publish supports that workflow:

- [MCP integrations](/py/latest/mcp/) that let assistants interact with tmux.
- Markdown documentation and `llms.txt` and `llms-full.txt` resources linked
  from documentation pages.
- `AGENTS.md` and other repository instructions for tools working on the
  codebase.

Use the documentation for the package, language, and version you are working
with.

### How the ports are made

The ports build on [tmuxp](https://tmuxp.git-pull.com/), started in 2013, and
[libtmux](https://libtmux.git-pull.com/), started in 2016. Both projects
predate today's LLM coding tools. Current work on the original projects and the
ports uses AI assistance.

Maintainers guide the design, review changes, test behavior against real tmux,
and decide what ships. They remain responsible for what the projects include
and maintain.

### Stability

Packages in the [libtmux organization](https://github.com/libtmux) are
experimental unless their README says otherwise. Names and APIs may change
between releases. Pin an exact version and review changes before upgrading.

## 2. For contributors: How to report issues, ideas, suggestions, and security issues

A useful issue is a contribution in its own right. Your experience helps us see
what breaks, what feels awkward, and what is missing. You do not need to arrive
with a patch.

Open bugs, ideas, and suggestions in the repository of the package they
concern. Report suspected security vulnerabilities privately using the route
below.

### Bugs

Tell us what you tried, what happened, and what you expected. Include a small
example we can run, the library and tmux versions, and the actual output.
Include relevant logs and error messages as they appeared, and distinguish what
you observed from possible explanations.

Bug reports are welcome whether the code you were running was handwritten or
generated. Include the code that ran. A conversation transcript is usually
unnecessary; include relevant prompts or tool calls when they are needed to
reproduce the problem.

### Ideas and suggestions

Explain what you wanted to accomplish and where the current design gets in
your way. We welcome feedback on:

- Usability: what was hard to find or get right, and where the documentation
  misled you.
- Language conventions: whether a port feels natural in the language you use.
- Aesthetics: how an API, a page, or an error message reads.
- Missing capabilities: what you could not accomplish with the current API.

If an API you expected is missing, describe the task and why that API would
help.

### Security issues

Report suspected security vulnerabilities privately. Use **Report a
vulnerability** on the affected repository's security page where available.

Include the affected package and version, the tmux version, what you observed,
and reproduction steps or relevant code references if available. Distinguish
verified behavior from suspected impact. Please coordinate public disclosure
with us so we can investigate and, where needed, prepare a fix.

Command execution explicitly requested through documented features is expected
behavior and does not, by itself, establish a vulnerability. Explain any
additional failure, such as data being interpreted as commands unexpectedly or
an intended security boundary being crossed.

### Writing your report

Short reports, typos, and imperfect English are fine. Translation and writing
assistance are welcome; check that the result says what you mean and preserves
the facts you observed. Your experience matters more than a polished report.

### Using AI tools

If AI materially helped prepare your issue, comment, discussion, review, or
pull request, say which tools you used, what they did, and what you checked
yourself. Using these tools does not count against a contribution. You remain
responsible for what you submit.

Do not send generated code, reports, or explanations you have not checked.

### Pull requests

Before preparing a pull request, open an issue or comment on an existing issue
about the proposed change. Wait for a maintainer to invite a PR for an agreed
scope. Opening an issue alone is not an invitation. PRs submitted without that
agreement may be closed without review. Arrange security fixes through the
private reporting route.

Even when we agree that something should change, we may prefer to write the
implementation ourselves. Review must consider correctness, supported tmux
versions, language conventions, documentation, and ongoing maintenance.
Checking those can take more time than writing the change, whether it was
handwritten or generated.

If we invite a PR, understand the changes, test them, and be able to explain
them. Follow the project's contribution instructions, and describe the tests
you ran and the versions you used. Generated code and tests can share the same
mistake, so passing tests alone do not show that a change fits the project.

Submit only material you have the right to contribute on terms compatible with
the project's license. Identify outside code, tests, or text incorporated into
the contribution, including material adapted with AI assistance, and provide
its source and license. Keep required notices, and raise unclear permissions
before including the material. These source and licensing requirements apply
to maintainers too.
