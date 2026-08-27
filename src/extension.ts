import * as vscode from 'vscode';
import { PromptsManager } from './promptsManager';
import { PromptsProvider, PromptItem } from './promptsProvider';
import { openPromptForm } from './promptForm';
import { Prompt } from './types';

export async function activate(context: vscode.ExtensionContext) {
  const manager = new PromptsManager(context);
  await manager.load();

  const provider = new PromptsProvider(manager);
  vscode.window.registerTreeDataProvider('promptdb.promptsList', provider);

  const reg = (cmd: string, fn: (...args: any[]) => any) =>
    context.subscriptions.push(vscode.commands.registerCommand(cmd, fn));

  // ── Add ──────────────────────────────────────────────────────────────────
  reg('promptdb.addPrompt', async () => {
    const result = await openPromptForm(context, manager.getCategories());
    if (!result) return;
    await manager.add(result);
    provider.refresh();
    vscode.window.setStatusBarMessage(`$(check) Prompt "${result.name}" saved`, 2500);
  });

  // ── Edit ─────────────────────────────────────────────────────────────────
  reg('promptdb.editPrompt', async (item: PromptItem) => {
    const result = await openPromptForm(context, manager.getCategories(), item.prompt);
    if (!result) return;
    await manager.update(item.prompt.id, result);
    provider.refresh();
    vscode.window.setStatusBarMessage(`$(check) Prompt "${result.name}" updated`, 2500);
  });

  // ── Delete ───────────────────────────────────────────────────────────────
  reg('promptdb.deletePrompt', async (item: PromptItem) => {
    const answer = await vscode.window.showWarningMessage(
      `Delete prompt "${item.prompt.name}"?`,
      { modal: true },
      'Delete'
    );
    if (answer !== 'Delete') return;
    await manager.delete(item.prompt.id);
    provider.refresh();
  });

  // ── Copy to clipboard ────────────────────────────────────────────────────
  reg('promptdb.copyPrompt', async (item: PromptItem) => {
    await vscode.env.clipboard.writeText(item.prompt.body);
    vscode.window.setStatusBarMessage(`$(clippy) "${item.prompt.name}" copied`, 2500);
  });

  // ── Insert at cursor ─────────────────────────────────────────────────────
  reg('promptdb.insertPrompt', async (item: PromptItem) => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      await vscode.env.clipboard.writeText(item.prompt.body);
      vscode.window.showInformationMessage(`No active editor — "${item.prompt.name}" copied to clipboard.`);
      return;
    }
    await editor.edit(eb => {
      for (const sel of editor.selections) eb.replace(sel, item.prompt.body);
    });
    vscode.window.setStatusBarMessage(`$(insert) "${item.prompt.name}" inserted`, 2500);
  });

  // ── Quick pick ───────────────────────────────────────────────────────────
  reg('promptdb.quickPick', async () => {
    const prompts = manager.getAll();
    if (!prompts.length) {
      vscode.window.showInformationMessage('No prompts yet — add one via the Prompt DB sidebar.');
      return;
    }

    interface PickItem extends vscode.QuickPickItem { prompt: Prompt; }

    const items: PickItem[] = prompts.map(p => ({
      label: p.name,
      description: p.category,
      detail: p.body.length > 160 ? p.body.slice(0, 160) + '…' : p.body,
      prompt: p,
      buttons: [
        { iconPath: new vscode.ThemeIcon('clippy'), tooltip: 'Copy to clipboard' },
        { iconPath: new vscode.ThemeIcon('insert'), tooltip: 'Insert at cursor' },
      ],
    }));

    const qp = vscode.window.createQuickPick<PickItem>();
    qp.items = items;
    qp.matchOnDescription = true;
    qp.matchOnDetail = true;
    qp.placeholder = 'Search prompts… (Enter = copy · use buttons to insert)';
    qp.title = 'Prompt DB';

    qp.onDidTriggerItemButton(async ({ button, item }) => {
      qp.hide();
      if (button.tooltip === 'Copy to clipboard') {
        await vscode.env.clipboard.writeText(item.prompt.body);
        vscode.window.setStatusBarMessage(`$(clippy) "${item.prompt.name}" copied`, 2500);
      } else {
        await insertAt(item.prompt);
      }
    });

    qp.onDidAccept(async () => {
      const sel = qp.selectedItems[0];
      qp.hide();
      if (!sel) return;
      await vscode.env.clipboard.writeText(sel.prompt.body);
      vscode.window.setStatusBarMessage(`$(clippy) "${sel.prompt.name}" copied`, 2500);
    });

    qp.show();
  });

  // ── Toggle grouping ───────────────────────────────────────────────────────
  reg('promptdb.toggleGrouping', () => provider.toggleGrouping());

  // ── Export ───────────────────────────────────────────────────────────────
  reg('promptdb.exportPrompts', async () => {
    const prompts = manager.getAll();
    if (!prompts.length) { vscode.window.showInformationMessage('Nothing to export.'); return; }
    const uri = await vscode.window.showSaveDialog({
      filters: { JSON: ['json'] },
      defaultUri: vscode.Uri.file('prompt-db-export.json'),
      title: 'Export Prompts',
    });
    if (!uri) return;
    await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(prompts, null, 2), 'utf8'));
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

    let imported: Prompt[];
    try {
      const raw = await vscode.workspace.fs.readFile(uris[0]);
      imported = JSON.parse(Buffer.from(raw).toString('utf8'));
      if (!Array.isArray(imported)) throw new Error();
    } catch {
      vscode.window.showErrorMessage('Import failed — file must be a JSON array of prompts.');
      return;
    }

    const mode = await vscode.window.showQuickPick(
      [
        { label: '$(add) Merge with existing', value: 'merge' },
        { label: '$(replace-all) Replace all', value: 'replace' },
      ],
      { title: 'Import Mode' }
    );
    if (!mode) return;

    if (mode.value === 'replace') {
      await manager.replaceAll(imported);
    } else {
      const existingIds = new Set(manager.getAll().map(p => p.id));
      const merged = [
        ...manager.getAll(),
        ...imported
          .filter(p => !existingIds.has(p.id))
          .map(p => ({ ...p, id: `${Date.now()}-${Math.random().toString(36).slice(2)}` })),
      ];
      await manager.replaceAll(merged);
    }

    provider.refresh();
    vscode.window.showInformationMessage(`Imported ${imported.length} prompts.`);
  });

  async function insertAt(prompt: Prompt) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      await vscode.env.clipboard.writeText(prompt.body);
      vscode.window.showInformationMessage(`No active editor — "${prompt.name}" copied to clipboard.`);
      return;
    }
    await editor.edit(eb => {
      for (const sel of editor.selections) eb.replace(sel, prompt.body);
    });
    vscode.window.setStatusBarMessage(`$(insert) "${prompt.name}" inserted`, 2500);
  }
}

export function deactivate() {}
