import * as vscode from 'vscode';
import { Prompt } from './types';
import { PromptsManager } from './promptsManager';

export class PromptItem extends vscode.TreeItem {
  constructor(public readonly prompt: Prompt) {
    super(prompt.name, vscode.TreeItemCollapsibleState.None);
    this.description = prompt.category || '';
    this.tooltip = new vscode.MarkdownString(
      `**${prompt.name}**${prompt.category ? `  \n_${prompt.category}_` : ''}\n\n---\n\n${prompt.body}`
    );
    this.contextValue = 'promptItem';
    this.command = {
      command: 'promptdb.copyPrompt',
      title: 'Copy to Clipboard',
      arguments: [this],
    };
  }
}

export class CategoryItem extends vscode.TreeItem {
  constructor(
    public readonly category: string,
    public readonly children: PromptItem[]
  ) {
    super(category || 'Uncategorized', vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = 'categoryItem';
    this.iconPath = new vscode.ThemeIcon('folder');
    this.description = `${children.length} prompt${children.length !== 1 ? 's' : ''}`;
  }
}

type TreeNode = CategoryItem | PromptItem;

export class PromptsProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly _onChange = new vscode.EventEmitter<TreeNode | undefined | void>();
  readonly onDidChangeTreeData = this._onChange.event;
  private groupByCategory = false;

  constructor(private readonly manager: PromptsManager) {}

  refresh(): void { this._onChange.fire(); }

  toggleGrouping(): void {
    this.groupByCategory = !this.groupByCategory;
    this.refresh();
  }

  getTreeItem(element: TreeNode): vscode.TreeItem { return element; }

  getChildren(element?: TreeNode): TreeNode[] {
    if (element instanceof CategoryItem) return element.children;

    const prompts = this.manager.getAll();
    if (!prompts.length) return [];

    if (!this.groupByCategory) {
      return prompts.map(p => new PromptItem(p));
    }

    const groups = new Map<string, Prompt[]>();
    for (const p of prompts) {
      const key = p.category || '';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(p);
    }
    return [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([cat, items]) => new CategoryItem(cat, items.map(p => new PromptItem(p))));
  }
}
