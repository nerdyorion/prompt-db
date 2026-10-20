# Prompt DB

VS Code / Cursor extension that stores named AI prompt snippets and pastes them from a sidebar or Quick Pick. Released under the MIT License (see the `LICENSE` file in this folder).

Prompts live in **global storage** (not in the workspace), so the same library is available in every window.

## Install

From a packaged VSIX:

```bash
code --install-extension prompt-db-0.1.1.vsix
```

Or in Cursor / VS Code: **Extensions → ⋯ → Install from VSIX…** and pick `prompt-db-0.1.1.vsix`.

Upgrading from 0.1.0 keeps your existing prompts. Do not change `publisher` or `name` in `package.json` — that storage path is how installs find `prompts.json`.

## Usage

1. Open the **Prompt DB** icon in the activity bar.
2. Add a prompt (name, optional category, body).
3. Copy, insert at the cursor, or edit from the inline icons. Clicking a row opens the editor.
4. Search with the magnifying glass, or **Ctrl+Shift+`** / **Cmd+Shift+`**.
5. Toggle category grouping from the tree toolbar. The choice is remembered.

Empty libraries show a welcome view with Add and Import.

### Import / export

Export writes a JSON **array** of prompts:

```json
[
  {
    "id": "1710000000000-abc",
    "name": "Write unit tests",
    "body": "Cover the happy path and failures.",
    "category": "testing",
    "createdAt": 1710000000000
  }
]
```

Import accepts that array, or `{ "prompts": [ … ] }`.

- **Merge** — keep existing prompts. Same `id` updates name/body/category. Same name+category+body with a different id is treated as a duplicate and skipped. Re-importing the same file does not create copies.
- **Replace all** — asks for confirmation, then replaces the library.

Invalid rows are ignored; the toast reports how many were added, updated, skipped, or dropped.

## Where data is stored

| App | Path |
| --- | --- |
| VS Code (macOS) | `~/Library/Application Support/Code/User/globalStorage/prompt-db.prompt-db/prompts.json` |
| Cursor (macOS) | `~/Library/Application Support/Cursor/User/globalStorage/prompt-db.prompt-db/prompts.json` |
| VS Code (Linux) | `~/.config/Code/User/globalStorage/prompt-db.prompt-db/prompts.json` |
| VS Code (Windows) | `%APPDATA%\Code\User\globalStorage\prompt-db.prompt-db\prompts.json` |

If the file is unreadable, Prompt DB copies it to `prompts.bak-<timestamp>.json` (and may move the original to `prompts.corrupt-<timestamp>.json`) instead of replacing it with an empty list. Saving is blocked if the live file could not be read, so a transient I/O error cannot wipe the library.

## Develop

```bash
npm install
npm test          # compile + unit tests
npm run watch     # typecheck in the background
npm run package   # write prompt-db-<version>.vsix
```

Launch **Run Extension** from `.vscode/launch.json` to open an Extension Development Host.

| File | Role |
| --- | --- |
| `src/extension.ts` | Commands, Quick Pick, import/export |
| `src/promptsManager.ts` | Load/save `prompts.json` |
| `src/vscodeStore.ts` | VS Code filesystem adapter |
| `src/promptCodec.ts` | Validation, merge, ids |
| `src/promptsProvider.ts` | Sidebar tree |
| `src/promptForm.ts` | Add/edit webview |
