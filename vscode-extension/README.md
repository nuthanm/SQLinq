# SQLinq VS Code Extension

This folder contains the first working VS Code extension slice for SQLinq.

## Current scope

- Command: `SQLinq: Convert SQL to LINQ`
- Command: `SQLinq: Quick Convert Selection`
- Command: `SQLinq: Open Converter UI`
- Input: selected SQL text, or a prompt if nothing is selected
- Output: replaces the selection with a basic LINQ translation
- Supported SQL shape: `SELECT`, `FROM`, optional `WHERE`, optional `ORDER BY`

## UI

The converter UI opens inside VS Code as a webview. It gives you a SQL input box, a target selector, a LINQ preview, and buttons for convert, copy, and insert.

It also includes a connectivity mode selector:

- Without DB connectivity: offline conversion, recognized-clause summary, unsupported warnings.
- With DB connectivity: everything above plus schema validation opportunities, plan guidance, and optional sample-row checks.

## Testing

1. Open this folder in VS Code.
2. Run `SQLinq: Quick Convert Selection` to convert selected SQL immediately with method syntax.
3. Run `SQLinq: Open Converter UI` for the interactive preview workflow.
4. Paste or edit a simple `SELECT` query.
5. Press `Convert` to preview the LINQ, then `Insert into editor` if you want to push it back into the active file.

## Sync with web app tracking

Configure these settings in VS Code to sync conversion events into the web app backend:

- `sqlinq.telemetryEndpoint`
	- Example: `http://localhost:5173/api/events/conversion`
- `sqlinq.telemetrySource`
	- Default: `vscode-extension`

Telemetry sync is best-effort and does not block conversion commands.

## What to do next

1. Add JOIN handling.
2. Add result preview instead of direct replacement.
3. Split the converter into a shared core used by VS Code and Visual Studio shells.