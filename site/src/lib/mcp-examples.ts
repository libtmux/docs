// scripts/gen-mcp-transcript.mjs imports this module with bare Node, so it has no imports.

export interface ExampleStep { tool: string; arguments: Record<string, unknown>; caption: string }
export interface ExampleDefinition { prompt: string; steps: ExampleStep[] }

const CREATE = 'Create the session.'
const RUN = 'Run the command and wait for its output.'
const RUN_IN_CREATED = 'Run the command in the pane the create result returned (%0).'
const RUN_IN_LISTED = 'Run the command in the pane the list returned (%0).'
const REMOVE = 'Remove the session once the result is read.'
const REMOVE_BY_ID = 'Remove the session by the id the create result returned ($0).'
const CHECKS = 'Create a tmux session called checks, run pytest -q in it, show me the result, then remove the session.'
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
  py: { prompt: CHECKS, steps: [
    { tool: 'create_session', arguments: { session_name: 'checks' }, caption: CREATE },
    { tool: 'run_command', arguments: { session_name: 'checks', ...RUN_COMMAND }, caption: RUN },
    { tool: 'kill_session', arguments: { session_name: 'checks' }, caption: REMOVE },
  ] },
  ts: { prompt: CHECKS, steps: [
    { tool: 'create_session', arguments: { name: 'checks' }, caption: CREATE },
    { tool: 'run_shell_command', arguments: { paneId: '%0', ...RUN_COMMAND }, caption: RUN_IN_CREATED },
    { tool: 'kill_session', arguments: { session: 'checks' }, caption: REMOVE },
  ] },
  swift: { prompt: CHECKS, steps: [
    { tool: 'create_session', arguments: { name: 'checks' }, caption: CREATE },
    { tool: 'list_panes', arguments: { session: 'checks' }, caption: 'List the panes in the new session.' },
    { tool: 'run_shell_command', arguments: { paneId: '%0', ...RUN_COMMAND }, caption: RUN_IN_LISTED },
    { tool: 'kill_session', arguments: { session: 'checks' }, caption: REMOVE },
  ] },
  csharp: { prompt: CHECKS, steps: [
    { tool: 'create_session', arguments: { name: 'checks' }, caption: CREATE },
    { tool: 'run_shell_command', arguments: { paneId: '%0', ...RUN_COMMAND }, caption: RUN_IN_CREATED },
    { tool: 'kill_session', arguments: { session: 'checks' }, caption: REMOVE },
  ] },
  cxx: { prompt: CHECKS, steps: [
    { tool: 'create_session', arguments: { name: 'checks' }, caption: CREATE },
    { tool: 'list_panes', arguments: {}, caption: 'List the panes, each with its session id.' },
    { tool: 'run_shell_command', arguments: { paneId: '%0', ...RUN_COMMAND }, caption: RUN_IN_LISTED },
    { tool: 'kill_session', arguments: { session: 'checks' }, caption: REMOVE },
  ] },
  rs: { prompt: CHECKS, steps: [
    { tool: 'create_session', arguments: { name: 'checks' }, caption: CREATE },
    { tool: 'list_windows', arguments: {}, caption: 'List the windows, each with its session id.' },
    { tool: 'list_panes', arguments: {}, caption: 'List the panes, each with its window id.' },
    { tool: 'run_shell_command', arguments: { pane: '%0', ...RUN_COMMAND }, caption: RUN_IN_LISTED },
    { tool: 'kill_session', arguments: { session: 'checks' }, caption: REMOVE },
  ] },
  go: { prompt: CHECKS, steps: [
    { tool: 'create_session', arguments: { session_name: 'checks' }, caption: CREATE },
    { tool: 'list_panes', arguments: {}, caption: 'List the panes, each with the session it belongs to.' },
    { tool: 'run_shell_command', arguments: { pane_id: '%0', ...RUN_COMMAND }, caption: RUN_IN_LISTED },
    { tool: 'kill_session', arguments: { session_id: '$0' }, caption: REMOVE_BY_ID },
  ] },
  java: { prompt: CHECKS, steps: [
    { tool: 'create_session', arguments: { session_name: 'checks' }, caption: CREATE },
    { tool: 'list_panes', arguments: {}, caption: 'List the panes, each with the session it belongs to.' },
    { tool: 'run_shell_command', arguments: { pane_id: '%0', ...RUN_COMMAND }, caption: RUN_IN_LISTED },
    { tool: 'kill_session', arguments: { session_id: '$0' }, caption: REMOVE_BY_ID },
  ] },
  ruby: { prompt: 'List the panes on my tmux server.', steps: [
    { tool: 'tmux_capabilities', arguments: {}, caption: 'Ask the server which tools and limits are enabled.' },
    { tool: 'tmux_snapshot', arguments: { entity: 'pane', limit: 20 }, caption: 'List the panes.' },
  ] },
  julia: { prompt: 'Show me what the first pane is displaying.', steps: [
    { tool: 'list_panes', arguments: { limit: 10 }, caption: 'List the panes. Each result carries a target.' },
    { tool: 'capture_pane', arguments: { target: { paneId: '%0', generation: '3f9a1c' } }, caption: 'Read the pane through the target the list returned (%0).' },
  ] },
}
