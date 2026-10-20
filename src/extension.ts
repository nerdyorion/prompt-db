import * as os from 'os';
import * as vscode from 'vscode';
import { PromptsManager } from './promptsManager';
import { createPromptsManager } from './vscodeStore';
import { PromptsProvider, PromptItem } from './promptsProvider';
import { openPromptForm } from './promptForm';
import { mergeImported, parsePromptStore } from './promptCodec';
import { Prompt } from './types';

const GROUPING_KEY = 'promptdb.groupByCategory';

export async function activate(context: vscode.ExtensionContext) {
  const manager = createPromptsManager(context);
  await manager.load();

  const provider = new PromptsProvider(
    manager,
    context.globalState.get<boolean>(GROUPING_KEY, false)
  );
  const treeView = vscode.window.createTreeView('promptdb.promptsList', {
    treeDataProvider: provider,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView, provider);

  const reg = (cmd: string, fn: (...args: any[]) => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(cmd, fn));

  const refresh = () => provider.refresh();

  async function save(action: () => Promise<unknown>): Promise<boolean> {
    try {
      await action();
      refresh();
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Prompt DB could not save: ${message}`);
      return false;
    }
  }

  async function resolvePrompt(item?: PromptItem): Promise<Prompt | undefined> {
    if (item?.prompt) return item.prompt;
    return pickPrompt(manager, 'Select a prompt');
  }

  async function copyPrompt(prompt: Prompt): Promise<void> {
    await vscode.env.clipboard.writeText(prompt.body);
    vscode.window.setStatusBarMessage(`$(clippy) "${prompt.name}" copied`, 2500);
  }

  async function insertAt(prompt: Prompt): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      await vscode.env.clipboard.writeText(prompt.body);
      vscode.window.showInformationMessage(
        `No active editor — "${prompt.name}" copied to clipboard.`
      );
      return;
    }
    const applied = await editor.edit(eb => {
      for (const sel of editor.selections) eb.replace(sel, prompt.body);
    });
    if (!applied) {
      vscode.window.showWarningMessage(
        `Could not insert "${prompt.name}" — the editor may be read-only.`
      );
      return;
    }
    vscode.window.setStatusBarMessage(`$(insert) "${prompt.name}" inserted`, 2500);
  }

  // ── Add ──────────────────────────────────────────────────────────────────
  reg('promptdb.addPrompt', async () => {
    const result = await openPromptForm(context, manager.getCategories());
    if (!result) return;
    if (!(await save(() => manager.add(result)))) return;
    vscode.window.setStatusBarMessage(`$(check) Prompt "${result.name}" saved`, 2500);
  });

  // ── Edit ─────────────────────────────────────────────────────────────────
  reg('promptdb.editPrompt', async (item?: PromptItem) => {
    const prompt = await resolvePrompt(item);
    if (!prompt) return;
    const result = await openPromptForm(context, manager.getCategories(), prompt);
    if (!result) return;
    if (!(await save(() => manager.update(prompt.id, result)))) return;
    vscode.window.setStatusBarMessage(`$(check) Prompt "${result.name}" updated`, 2500);
  });

  // ── Delete ───────────────────────────────────────────────────────────────
  reg('promptdb.deletePrompt', async (item?: PromptItem) => {
    const prompt = await resolvePrompt(item);
    if (!prompt) return;
    const answer = await vscode.window.showWarningMessage(
      `Delete prompt "${prompt.name}"?`,
      { modal: true },
      'Delete'
    );
    if (answer !== 'Delete') return;
    await save(() => manager.delete(prompt.id));
  });

  // ── Copy to clipboard ────────────────────────────────────────────────────
  reg('promptdb.copyPrompt', async (item?: PromptItem) => {
    const prompt = await resolvePrompt(item);
    if (!prompt) return;
    await copyPrompt(prompt);
  });

  // ── Insert at cursor ─────────────────────────────────────────────────────
  reg('promptdb.insertPrompt', async (item?: PromptItem) => {
    const prompt = await resolvePrompt(item);
    if (!prompt) return;
    await insertAt(prompt);
  });

  // ── Quick pick ───────────────────────────────────────────────────────────
  reg('promptdb.quickPick', async () => {
    const prompt = await pickPrompt(manager, 'Search prompts… (Enter = copy · use buttons to insert)', {
      copyAndInsertButtons: true,
      onCopy: copyPrompt,
      onInsert: insertAt,
    });
    if (!prompt) return;
    await copyPrompt(prompt);
  });

  // ── Toggle grouping ───────────────────────────────────────────────────────
  reg('promptdb.toggleGrouping', async () => {
    provider.toggleGrouping();
    await context.globalState.update(GROUPING_KEY, provider.isGrouped());
    vscode.window.setStatusBarMessage(
      provider.isGrouped()
        ? '$(folder) Prompt DB: grouped by category'
        : '$(list-flat) Prompt DB: flat list',
      2500
    );
  });

  // ── Export ───────────────────────────────────────────────────────────────
  reg('promptdb.exportPrompts', async () => {
    const prompts = manager.getAll();
    if (!prompts.length) {
      vscode.window.showInformationMessage('Nothing to export.');
      return;
    }
    const folder =
      vscode.workspace.workspaceFolders?.[0]?.uri ??
      vscode.Uri.file(os.homedir());
    const uri = await vscode.window.showSaveDialog({
      filters: { JSON: ['json'] },
      defaultUri: vscode.Uri.joinPath(folder, 'prompt-db-export.json'),
      title: 'Export Prompts',
    });
    if (!uri) return;
    try {
      await vscode.workspace.fs.writeFile(
        uri,
        Buffer.from(JSON.stringify(prompts, null, 2), 'utf8')
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Prompt DB could not export: ${message}`);
      return;
    }
    vscode.window.showInformationMessage(`Exported ${prompts.length} prompts.`);
  });

  // ── Import ───────────────────────────────────────────────────────────────
  reg('promptdb.importPrompts', async () => {
    const uris = await vscode.window.showOpenDialog({
      filters: { JSON: ['json'] },
      canSelectMany: false,
      title: 'Import Prompts',
    });
    if (!uris?.length) return;

    let parsed: unknown;
    try {
      const raw = await vscode.workspace.fs.readFile(uris[0]);
      parsed = JSON.parse(Buffer.from(raw).toString('utf8'));
    } catch {
      vscode.window.showErrorMessage(
        'Import failed — file is not valid JSON.'
      );
      return;
    }

    const result = parsePromptStore(parsed);
    if (!result.ok) {
      vscode.window.showErrorMessage(`Import failed — ${result.reason}`);
      return;
    }
    if (!result.prompts.length) {
      vscode.window.showErrorMessage(
        'Import failed — no valid prompts found in that file.'
      );
      return;
    }

    const mode = await vscode.window.showQuickPick(
      [
        { label: '$(add) Merge with existing', value: 'merge' as const },
        { label: '$(replace-all) Replace all', value: 'replace' as const },
      ],
      { title: 'Import Mode' }
    );
    if (!mode) return;

    if (mode.value === 'replace') {
      const existingCount = manager.getAll().length;
      const confirm = await vscode.window.showWarningMessage(
        existingCount
          ? `Replace all ${existingCount} existing prompt(s) with ${result.prompts.length} imported prompt(s)? This cannot be undone.`
          : `Import ${result.prompts.length} prompt(s)?`,
        { modal: true },
        'Replace'
      );
      if (confirm !== 'Replace') return;
      if (!(await save(() => manager.replaceAll(result.prompts)))) return;
      const droppedNote =
        result.dropped > 0 ? ` (${result.dropped} invalid skipped)` : '';
      vscode.window.showInformationMessage(
        `Imported ${result.prompts.length} prompts.${droppedNote}`
      );
      return;
    }

    const merged = mergeImported(manager.getAll(), result.prompts);
    if (merged.added === 0 && merged.updated === 0) {
      const parts = ['nothing to add'];
      if (merged.skipped) parts.push(`skipped ${merged.skipped} duplicate(s)`);
      if (result.dropped) parts.push(`${result.dropped} invalid ignored`);
      vscode.window.showInformationMessage(`Import complete — ${parts.join(', ')}.`);
      return;
    }
    if (!(await save(() => manager.replaceAll(merged.prompts)))) return;
    const parts: string[] = [];
    if (merged.added) parts.push(`added ${merged.added}`);
    if (merged.updated) parts.push(`updated ${merged.updated}`);
    if (merged.skipped) parts.push(`skipped ${merged.skipped} duplicate(s)`);
    if (result.dropped) parts.push(`${result.dropped} invalid ignored`);
    vscode.window.showInformationMessage(`Import complete — ${parts.join(', ')}.`);
  });
}

export function deactivate() {}

interface PickOptions {
  copyAndInsertButtons?: boolean;
  onCopy?: (prompt: Prompt) => Promise<void>;
  onInsert?: (prompt: Prompt) => Promise<void>;
}

function pickPrompt(
  manager: PromptsManager,
  placeholder: string,
  options: PickOptions = {}
): Promise<Prompt | undefined> {
  const prompts = manager.getAll();
  if (!prompts.length) {
    vscode.window.showInformationMessage(
      'No prompts yet — add one via the Prompt DB sidebar.'
    );
    return Promise.resolve(undefined);
  }

  interface PickItem extends vscode.QuickPickItem {
    prompt: Prompt;
  }

  const copyBtn: vscode.QuickInputButton = {
    iconPath: new vscode.ThemeIcon('clippy'),
    tooltip: 'Copy to clipboard',
  };
  const insertBtn: vscode.QuickInputButton = {
    iconPath: new vscode.ThemeIcon('insert'),
    tooltip: 'Insert at cursor',
  };

  const items: PickItem[] = prompts.map(p => ({
    label: p.name,
    description: p.category,
    detail: p.body.length > 160 ? p.body.slice(0, 160) + '…' : p.body,
    prompt: p,
    buttons: options.copyAndInsertButtons ? [copyBtn, insertBtn] : undefined,
  }));

  const qp = vscode.window.createQuickPick<PickItem>();
  qp.items = items;
  qp.matchOnDescription = true;
  qp.matchOnDetail = true;
  qp.placeholder = placeholder;
  qp.title = 'Prompt DB';

  return new Promise(resolve => {
    let settled = false;
    const finish = (value: Prompt | undefined) => {
      if (settled) return;
      settled = true;
      qp.hide();
      qp.dispose();
      resolve(value);
    };

    qp.onDidTriggerItemButton(async ({ button, item }) => {
      if (button === copyBtn) {
        await options.onCopy?.(item.prompt);
        finish(undefined);
      } else if (button === insertBtn) {
        await options.onInsert?.(item.prompt);
        finish(undefined);
      }
    });

    qp.onDidAccept(() => {
      finish(qp.selectedItems[0]?.prompt);
    });

    qp.onDidHide(() => {
      if (!settled) {
        settled = true;
        qp.dispose();
        resolve(undefined);
      }
    });

    qp.show();
  });
}
