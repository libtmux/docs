#!/usr/bin/env python3
"""Compile and run eight shared Go examples on isolated tmux servers.

Usage: python3 scripts/check-go-prose.py --checkout PATH [--ref REF]
The default ref is the source revision in the integrated Go API model.
This is an optional native verification gate; it needs Go and tmux on PATH.
"""
from pathlib import Path
import argparse
import json
import os
import re
import subprocess
import tempfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--checkout', type=Path, required=True)
parser.add_argument('--ref')
args = parser.parse_args()
repo = Path(__file__).resolve().parent.parent
model = json.loads((repo / 'site/src/data/api/go.json').read_text())
revision = subprocess.check_output(
    ['git', '-C', str(args.checkout), 'rev-parse', (args.ref or model['revision']) + '^{commit}'], text=True
).strip()
root = repo / 'site/src/content/docs/topics'

def verify(root, out, source, revision):
    go_version = re.search(r'^go (.+)$', (source / 'go.mod').read_text(), re.M).group(1)
    (out / 'go.mod').write_text(
        f'module docs-check\n\ngo {go_version}\n\n'
        'require github.com/libtmux/libtmux-go v0.0.0\n\n'
        f'replace github.com/libtmux/libtmux-go => {source.resolve()}\n'
    )
    parts=['''package docscheck
    import (
        "context"
        "errors"
        "fmt"
        "testing"
        "os"
        "time"
        "github.com/libtmux/libtmux-go/tmux"
        "github.com/libtmux/libtmux-go/tmux/tmuxtest"
    )
    ''']
    givens={'pane-interaction':['pane tmux.Pane','pane tmux.Pane'], 'options-and-hooks':['window tmux.Window','session tmux.Session'], 'waiting-and-retry':['session tmux.Session','server tmux.Server']}
    for name in [*givens, 'context-managers']:
        matches = list(re.finditer(r'^```go[^\n]*\n(.*?)^```', (root/(name+'.md')).read_text(), re.M|re.S))
        assert len(matches) == (1 if name == 'context-managers' else 2), f'Update verification for changed {name} examples'
        for index, match in enumerate(matches):
            code=match[1]
            if name=='context-managers':parts.append(code);continue
            fn=name.replace('-','')+str(index)
            parts.append('func '+fn+'(ctx context.Context, '+givens[name][index]+') error {\n'+code+'\nreturn nil\n}\n')
    transports = list(re.finditer(r'^```go[^\n]*\n(.*?)^```',
        (root.parent/'concepts/transports.md').read_text(), re.M|re.S))
    assert len(transports) == 1, 'Update verification for changed transport examples'
    parts.append('func transportExample() error {\n'+transports[0][1]+'\n}\n')
    parts.append('''
    func TestMain(m *testing.M) { os.Exit(tmuxtest.Main(m)) }

    func TestTransportExample(t *testing.T) {
        ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
        defer cancel()
        server := tmuxtest.NewServerWithOptions(ctx, t, tmuxtest.ServerOptions{FixedShell: true})
        t.Setenv("TMUX", server.SocketPath()+",0,0")
        if err := transportExample(); err != nil { t.Fatal(err) }
        filter := tmux.TmuxFilter("#{==:#{session_name},work}")
        sessions, err := server.SearchSessions(ctx, &filter)
        if err != nil || len(sessions) != 1 { t.Fatalf("created session: %v, %v", sessions, err) }
        panes, err := sessions[0].SearchPanes(ctx, nil)
        if err != nil || len(panes) != 1 { t.Fatalf("created pane: %v, %v", panes, err) }
        tmuxtest.WaitForLine(ctx, t, panes[0], "hello")
    }

    func TestPublishedExamples(t *testing.T) {
        ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
        defer cancel()
        server := tmuxtest.NewServerWithOptions(ctx, t, tmuxtest.ServerOptions{Config: []byte("set-window-option -g automatic-rename off\\n"), FixedShell: true})
        session := tmuxtest.NewSession(ctx, t, server, tmux.NewSessionRequest{})
        name := "build"
        window := tmuxtest.NewWindow(ctx, t, session, tmux.NewWindowRequest{Name: &name})
        panes, err := window.SearchPanes(ctx, nil)
        if err != nil || len(panes) != 1 { t.Fatalf("setup panes: %v, %v", panes, err) }
        pane := panes[0]
        calls := []struct { name string; run func() error }{
            {"send", func() error { return paneinteraction0(ctx, pane) }},
            {"capture", func() error { return paneinteraction1(ctx, pane) }},
            {"options", func() error { return optionsandhooks0(ctx, window) }},
            {"hooks", func() error { return optionsandhooks1(ctx, session) }},
            {"poll", func() error { return waitingandretry0(ctx, session) }},
            {"channel", func() error { return waitingandretry1(ctx, server) }},
            {"cleanup", func() error { return temporarySession(ctx, server) }},
        }
        for _, call := range calls {t.Run(call.name, func(t *testing.T) {
            if err := call.run(); err != nil { t.Fatal(err) }
        })}
        if err := tmuxtest.WaitFor(ctx, 10*time.Millisecond, func(ctx context.Context) (bool, error) {
            lines, err := pane.Capture(ctx, tmux.CapturePaneRequest{})
            for _, line := range lines { if line == "hello" { return true, err } }
            return false, err
        }); err != nil { t.Fatalf("literal input did not execute: %v", err) }
        if err := paneinteraction0(ctx, tmux.Pane{}); err == nil { t.Fatal("invalid pane error was swallowed") }
        expired, stop := context.WithCancel(ctx); stop()
        if err := waitingandretry0(expired, session); !errors.Is(err, context.Canceled) {t.Fatalf("cancellation lost: %v", err)}
        sessions, err := server.Sessions(ctx)
        if err != nil || len(sessions) != 1 || sessions[0].ID() != session.ID() {t.Fatalf("owned cleanup changed sessions: %v, %v", sessions, err)}
    }
    ''')
    (out/'examples_test.go').write_text('\n'.join(parts))

    env = {key: value for key, value in os.environ.items() if key not in ['TMUX', 'TMUX_PANE', 'GOWORK']}
    env['GOWORK'] = 'off'
    env['TMUX_TMPDIR'] = str(out)
    print(f'Go prose: {revision}; eight examples from five pages', flush=True)
    subprocess.run(['go', 'test', '-count=1', '-v', '.'], cwd=out, env=env, check=True)

with tempfile.TemporaryDirectory(prefix='libtmux-go-prose-') as temporary:
    out = Path(temporary)
    source = out / 'source'
    source.mkdir()
    archive = subprocess.check_output(['git', '-C', str(args.checkout), 'archive', revision])
    subprocess.run(['tar', '-xf', '-', '-C', str(source)], input=archive, check=True)
    verify(root, out, source, revision)
