// scripts/gen-mcp-transcript.mjs imports this module with bare Node, so it has no imports.

export interface ExampleStep { tool: string; arguments: Record<string, unknown>; caption: string }
export interface ExampleDefinition { prompt: string; steps: ExampleStep[] }

/** The error code a server answers when a call sends the example's stand-in generation: the page tells the reader it is refused as this. */
export const STALE_TARGET = 'stale_target'

const CREATE = 'Create the session.'
const RUN = 'Run the command and wait for its output.'
const RUN_IN_CREATED = 'Run the command in the pane the create result returned (%0).'
const RUN_IN_LISTED = 'Run the command in the pane the list returned (%0).'
const REMOVE = 'Remove the session once the result is read.'
const REMOVE_BY_ID = 'Remove the session by the id the create result returned ($0).'
const CHECKS = 'Create a tmux session called checks, run pytest -q in it, show me the result, then remove the session.'
const SPLIT = 'Create a tmux session called checks, split its window into two panes, run pytest -q in one and show checks.log in the other, show me the results, then remove the session.'
const SPLIT_PANE = 'Split the pane the create result returned (%0) in two.'
const SHOW_LOG = 'Show the log in the new pane the split returned (%1).'
const RUN_TESTS = 'Run the tests in the pane the create result returned (%0).'
const LAYOUT = "Read the window's layout."
const SHOW_LOG_COMMAND = { command: 'cat checks.log' }
const RUN_COMMAND = { command: 'pytest -q' }

/**
 * A prompt, and the calls an agent makes for it, in each server's own tools and
 * argument names. `site/test/mcp-showcase.test.ts` checks every call against
 * the tool's input schema in the port's snapshot.
 *
 * A session (`$0`) or pane (`%0`) id in a call is not something the prompt
 * supplies: an earlier result returned it, and the call's caption says so. A
 * server whose `create_session` result carries no pane id is followed by a
 * listing that does. The test checks each id against the earlier tools'
 * output schemas.
 */
export const EXAMPLES: Record<string, ExampleDefinition> = {
  py: { prompt: SPLIT, steps: [
    { tool: 'create_session', arguments: { session_name: 'checks' }, caption: CREATE },
    { tool: 'split_window', arguments: { pane_id: '%0', direction: 'right' }, caption: SPLIT_PANE },
    { tool: 'list_windows', arguments: { session_name: 'checks' }, caption: LAYOUT },
    { tool: 'run_command', arguments: { pane_id: '%0', ...RUN_COMMAND }, caption: RUN_TESTS },
    { tool: 'run_command', arguments: { pane_id: '%1', ...SHOW_LOG_COMMAND }, caption: SHOW_LOG },
    { tool: 'kill_session', arguments: { session_name: 'checks' }, caption: REMOVE },
  ] },
  ts: { prompt: SPLIT, steps: [
    { tool: 'create_session', arguments: { name: 'checks' }, caption: CREATE },
    { tool: 'split_window', arguments: { paneId: '%0', direction: 'right' }, caption: SPLIT_PANE },
    { tool: 'list_windows', arguments: { session: 'checks' }, caption: LAYOUT },
    { tool: 'run_shell_command', arguments: { paneId: '%0', ...RUN_COMMAND }, caption: RUN_TESTS },
    { tool: 'run_shell_command', arguments: { paneId: '%1', ...SHOW_LOG_COMMAND }, caption: SHOW_LOG },
    { tool: 'kill_session', arguments: { session: 'checks' }, caption: REMOVE },
  ] },
  swift: { prompt: SPLIT, steps: [
    { tool: 'create_session', arguments: { name: 'checks' }, caption: CREATE },
    { tool: 'list_panes', arguments: { session: 'checks' }, caption: 'List the panes in the new session.' },
    { tool: 'split_window', arguments: { paneId: '%0', direction: 'right' }, caption: 'Split the pane the list returned (%0) in two.' },
    { tool: 'get_tmux_variables', arguments: { names: ['window_layout'], paneId: '%0' }, caption: 'Read the window\'s layout through the pane the list returned (%0).' },
    { tool: 'run_shell_command', arguments: { paneId: '%0', ...RUN_COMMAND }, caption: 'Run the tests in the pane the list returned (%0).' },
    { tool: 'run_shell_command', arguments: { paneId: '%1', ...SHOW_LOG_COMMAND }, caption: SHOW_LOG },
    { tool: 'kill_session', arguments: { session: 'checks' }, caption: REMOVE },
  ] },
  csharp: { prompt: SPLIT, steps: [
    { tool: 'create_session', arguments: { name: 'checks' }, caption: CREATE },
    { tool: 'split_window', arguments: { paneId: '%0', direction: 'Right' }, caption: SPLIT_PANE },
    { tool: 'list_windows', arguments: { session: 'checks' }, caption: LAYOUT },
    { tool: 'run_shell_command', arguments: { paneId: '%0', ...RUN_COMMAND }, caption: RUN_TESTS },
    { tool: 'run_shell_command', arguments: { paneId: '%1', ...SHOW_LOG_COMMAND }, caption: SHOW_LOG },
    { tool: 'kill_session', arguments: { session: 'checks' }, caption: REMOVE },
  ] },
  cxx: { prompt: SPLIT, steps: [
    { tool: 'create_session', arguments: { name: 'checks' }, caption: CREATE },
    { tool: 'list_panes', arguments: {}, caption: 'List the panes, each with its session id.' },
    { tool: 'split_window', arguments: { paneId: '%0', direction: 'horizontal' }, caption: 'Split the pane the list returned (%0) in two.' },
    { tool: 'list_windows', arguments: { session: 'checks' }, caption: LAYOUT },
    { tool: 'run_shell_command', arguments: { paneId: '%0', ...RUN_COMMAND }, caption: 'Run the tests in the pane the list returned (%0).' },
    { tool: 'run_shell_command', arguments: { paneId: '%1', ...SHOW_LOG_COMMAND }, caption: SHOW_LOG },
    { tool: 'kill_session', arguments: { session: 'checks' }, caption: REMOVE },
  ] },
  rs: { prompt: SPLIT, steps: [
    { tool: 'create_session', arguments: { name: 'checks' }, caption: CREATE },
    { tool: 'list_panes', arguments: {}, caption: 'List the panes, each with its window id.' },
    { tool: 'split_window', arguments: { pane: '%0', direction: 'right' }, caption: 'Split the pane the list returned (%0) in two.' },
    { tool: 'get_tmux_variables', arguments: { names: ['window_layout'], pane: '%0' }, caption: 'Read the window\'s layout, which tmux calls window_layout, through the pane the list returned (%0).' },
    { tool: 'run_shell_command', arguments: { pane: '%0', ...RUN_COMMAND }, caption: 'Run the tests in the pane the list returned (%0).' },
    { tool: 'run_shell_command', arguments: { pane: '%1', ...SHOW_LOG_COMMAND }, caption: SHOW_LOG },
    { tool: 'kill_session', arguments: { session: 'checks' }, caption: REMOVE },
  ] },
  go: { prompt: SPLIT, steps: [
    { tool: 'create_session', arguments: { session_name: 'checks' }, caption: CREATE },
    { tool: 'list_panes', arguments: {}, caption: 'List the panes, each with the session it belongs to.' },
    { tool: 'split_window', arguments: { pane_id: '%0', direction: 'right' }, caption: 'Split the pane the list returned (%0) in two.' },
    { tool: 'list_panes', arguments: {}, caption: 'List the panes again; each now carries its position and size.' },
    { tool: 'run_shell_command', arguments: { pane_id: '%0', ...RUN_COMMAND }, caption: 'Run the tests in the pane the list returned (%0).' },
    { tool: 'run_shell_command', arguments: { pane_id: '%1', ...SHOW_LOG_COMMAND }, caption: SHOW_LOG },
    { tool: 'kill_session', arguments: { session_id: '$0' }, caption: REMOVE_BY_ID },
  ] },
  java: { prompt: SPLIT, steps: [
    { tool: 'create_session', arguments: { session_name: 'checks' }, caption: CREATE },
    { tool: 'list_panes', arguments: {}, caption: 'List the panes, each with the session it belongs to.' },
    { tool: 'split_window', arguments: { pane_id: '%0', direction: 'right' }, caption: 'Split the pane the list returned (%0) in two.' },
    { tool: 'get_tmux_variables', arguments: { names: ['window_layout'], pane: '%0' }, caption: 'Read the window\'s layout through the pane the list returned (%0).' },
    { tool: 'run_shell_command', arguments: { pane_id: '%0', ...RUN_COMMAND }, caption: 'Run the tests in the pane the list returned (%0).' },
    { tool: 'run_shell_command', arguments: { pane_id: '%1', ...SHOW_LOG_COMMAND }, caption: SHOW_LOG },
    { tool: 'kill_session', arguments: { session_id: '$0' }, caption: REMOVE_BY_ID },
  ] },
  // Ruby's targets carry the server's generation, which differs on every run; the recorder sends the listed one and keeps this token.
  ruby: { prompt: SPLIT, steps: [
    { tool: 'tmux_capabilities', arguments: {}, caption: 'Ask the server which tools and limits are enabled.' },
    { tool: 'tmux_create', arguments: { kind: 'session', name: 'checks', argv: ['sh'] }, caption: CREATE },
    { tool: 'tmux_create', arguments: { kind: 'pane', parent: { kind: 'pane', id: '%1', generation: '3f9a1c' }, direction: 'horizontal', argv: ['sh'] }, caption: 'Split the pane the create result returned (%1) in two.' },
    { tool: 'tmux_snapshot', arguments: { entity: 'window' }, caption: LAYOUT },
    { tool: 'tmux_send', arguments: { target: { kind: 'pane', id: '%1', generation: '3f9a1c' }, input: { type: 'text', text: 'pytest -q\n' } }, caption: 'Type the command into the pane the create result returned (%1).' },
    { tool: 'tmux_wait', arguments: { target: { kind: 'pane', id: '%1', generation: '3f9a1c' }, condition: { type: 'screen_contains', text: '2 passed' }, timeout: 10 }, caption: 'Wait for the test summary in the pane the create result returned (%1).' },
    { tool: 'tmux_send', arguments: { target: { kind: 'pane', id: '%2', generation: '3f9a1c' }, input: { type: 'text', text: 'cat checks.log\n' } }, caption: 'Type the command into the new pane the split returned (%2).' },
    { tool: 'tmux_wait', arguments: { target: { kind: 'pane', id: '%2', generation: '3f9a1c' }, condition: { type: 'screen_contains', text: 'checks finished' }, timeout: 10 }, caption: 'Wait for the last line of the log in the pane the split returned (%2).' },
    { tool: 'tmux_close', arguments: { target: { kind: 'session', id: '$1', generation: '3f9a1c' } }, caption: 'Remove the session by the id the create result returned ($1).' },
  ] },
  // LibTmuxMCP has no split tool, so the split is a tmux command typed into the pane. Its targets carry the server's generation, which differs on every run: the recorder sends the listed one and keeps this token.
  julia: { prompt: SPLIT, steps: [
    { tool: 'create_session', arguments: { name: 'checks', command: ['sh'] }, caption: CREATE },
    { tool: 'send_keys', arguments: { target: { paneId: '%1', generation: '3f9a1c' }, keys: ['tmux split-window -h sh', 'Enter'] }, caption: 'This server has no split tool, so split from inside the pane the create result returned (%1) with tmux itself.' },
    { tool: 'list_panes', arguments: { scope: { sessionId: '$1', generation: '3f9a1c' } }, caption: 'List the panes of the session the create result returned ($1); each carries its position and size.' },
    { tool: 'send_keys_and_wait', arguments: { target: { paneId: '%1', generation: '3f9a1c' }, keys: ['pytest -q', 'Enter'], text: '2 passed' }, caption: 'Run the tests in the pane the create result returned (%1) and wait for the summary.' },
    { tool: 'send_keys_and_wait', arguments: { target: { paneId: '%2', generation: '3f9a1c' }, keys: ['cat checks.log', 'Enter'], text: 'checks finished' }, caption: 'Show the log in the new pane the list returned (%2) and wait for its last line.' },
    { tool: 'teardown_session', arguments: { sessionId: '$1', generation: '3f9a1c' }, caption: 'Remove the session by the id the create result returned ($1).' },
  ] },
}
