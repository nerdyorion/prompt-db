import * as vscode from 'vscode';
import { PromptsManager, PromptStoreIO } from './promptsManager';

export function createPromptsManager(context: vscode.ExtensionContext): PromptsManager {
  const dir = context.globalStorageUri;
  const io: PromptStoreIO = {
    async ensureDir() {
      await vscode.workspace.fs.createDirectory(dir);
    },
    async readFile(name) {
      return vscode.workspace.fs.readFile(vscode.Uri.joinPath(dir, name));
    },
    async writeFile(name, data) {
      await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(dir, name), data);
    },
    async rename(from, to, overwrite) {
      await vscode.workspace.fs.rename(
        vscode.Uri.joinPath(dir, from),
        vscode.Uri.joinPath(dir, to),
        { overwrite: !!overwrite }
      );
    },
    notifyError(message) {
      void vscode.window.showErrorMessage(message);
    },
    notifyWarning(message) {
      void vscode.window.showWarningMessage(message);
    },
  };
  return new PromptsManager(io);
}
