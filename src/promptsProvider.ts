import * as vscode from 'vscode';
import { Prompt } from './types';
import { PromptsManager } from './promptsManager';
import { escapeMarkdown } from './promptCodec';

export class PromptItem extends vscode.TreeItem {
  constructor(public readonly prompt: Prompt) {
    super(prompt.name, vscode.TreeItemCollapsibleState.None);
    this.id = `prompt:${prompt.id}`;
    this.description = prompt.category || '';
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**${escapeMarkdown(prompt.name)}**`);
    if (prompt.category) {
      md.appendMarkdown(`  \n_${escapeMarkdown(prompt.category)}_`);
    }
    md.appendMarkdown('\n\n---\n\n');
    md.appendText(prompt.body);
    this.tooltip = md;
    this.contextValue = 'promptItem';
    this.command = {
      command: 'promptdb.editPrompt',
      title: 'Edit Prompt',
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
    this.id = `category:${category || '__none__'}`;
    this.contextValue = 'categoryItem';
    this.iconPath = new vscode.ThemeIcon('folder');
    this.description = `${children.length} prompt${children.length !== 1 ? 's' : ''}`;
  }
}

type TreeNode = CategoryItem | PromptItem;

export class PromptsProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly _onChange = new vscode.EventEmitter<TreeNode | undefined | void>();
  readonly onDidChangeTreeData = this._onChange.event;
  private groupByCategory: boolean;

  constructor(
    private readonly manager: PromptsManager,
    groupByCategory = false
  ) {
    this.groupByCategory = groupByCategory;
  }

  dispose(): void {
    this._onChange.dispose();
  }

  refresh(): void { this._onChange.fire(); }

  isGrouped(): boolean {
    return this.groupByCategory;
  }

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
