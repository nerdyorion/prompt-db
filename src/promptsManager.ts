import * as vscode from 'vscode';
import { Prompt } from './types';

export class PromptsManager {
  private readonly dbUri: vscode.Uri;
  private prompts: Prompt[] = [];

  constructor(context: vscode.ExtensionContext) {
    // Stored at: <vscode-global-storage>/<publisher.extension-id>/prompts.json
    // On macOS: ~/Library/Application Support/Code/User/globalStorage/prompt-db.prompt-db/prompts.json
    this.dbUri = vscode.Uri.joinPath(context.globalStorageUri, 'prompts.json');
  }

  async load(): Promise<void> {
    try {
      const raw = await vscode.workspace.fs.readFile(this.dbUri);
      this.prompts = JSON.parse(Buffer.from(raw).toString('utf8'));
    } catch {
      // File doesn't exist yet — start fresh
      this.prompts = [];
    }
  }

  getAll(): Prompt[] {
    return this.prompts;
  }

  getCategories(): string[] {
    return [...new Set(this.prompts.map(p => p.category).filter(Boolean))].sort();
  }

  async add(data: Omit<Prompt, 'id' | 'createdAt'>): Promise<Prompt> {
    const prompt: Prompt = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      createdAt: Date.now(),
      ...data,
    };
    this.prompts.push(prompt);
    await this.persist();
    return prompt;
  }

  async update(id: string, data: Partial<Pick<Prompt, 'name' | 'body' | 'category'>>): Promise<boolean> {
    const idx = this.prompts.findIndex(p => p.id === id);
    if (idx === -1) return false;
    this.prompts[idx] = { ...this.prompts[idx], ...data };
    await this.persist();
    return true;
  }

  async delete(id: string): Promise<boolean> {
    const before = this.prompts.length;
    this.prompts = this.prompts.filter(p => p.id !== id);
    if (this.prompts.length === before) return false;
    await this.persist();
    return true;
  }

  async replaceAll(prompts: Prompt[]): Promise<void> {
    this.prompts = prompts;
    await this.persist();
  }

  private async persist(): Promise<void> {
    // Ensure the directory exists
    await vscode.workspace.fs.createDirectory(
      vscode.Uri.joinPath(this.dbUri, '..')
    );
    await vscode.workspace.fs.writeFile(
      this.dbUri,
      Buffer.from(JSON.stringify(this.prompts, null, 2), 'utf8')
    );
  }
}
