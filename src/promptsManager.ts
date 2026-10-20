import { Prompt } from './types';
import { FormFields, newPromptId, parsePromptStore } from './promptCodec';

export interface PromptStoreIO {
  readFile(name: string): Promise<Uint8Array>;
  writeFile(name: string, data: Uint8Array): Promise<void>;
  rename(from: string, to: string, overwrite?: boolean): Promise<void>;
  ensureDir(): Promise<void>;
  notifyError(message: string): void;
  notifyWarning(message: string): void;
}

export class PromptsManager {
  private prompts: Prompt[] = [];
  /** False when the on-disk file exists but could not be read. Blocks save. */
  private storeReadable = true;

  constructor(private readonly io: PromptStoreIO) {}

  async load(): Promise<void> {
    let raw: Uint8Array;
    try {
      raw = await this.io.readFile('prompts.json');
    } catch (err) {
      if (isFileNotFound(err)) {
        this.prompts = [];
        this.storeReadable = true;
        return;
      }
      this.prompts = [];
      this.storeReadable = false;
      this.io.notifyError(
        `Prompt DB could not read prompts.json: ${errorMessage(err)}. Saving is disabled until this is resolved, so the file will not be overwritten.`
      );
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(raw).toString('utf8'));
    } catch {
      await this.quarantine(raw, 'invalid JSON');
      this.prompts = [];
      return;
    }

    const result = parsePromptStore(parsed);
    if (!result.ok) {
      await this.quarantine(raw, result.reason);
      this.prompts = [];
      return;
    }

    this.prompts = result.prompts;
    this.storeReadable = true;

    // Only rewrite the file when we had to fill missing IDs or drop junk.
    // A normal upgrade leaves the existing file untouched.
    if (result.migrated || result.dropped > 0) {
      try {
        await this.backupRaw(raw);
        await this.write(this.prompts);
        if (result.dropped > 0) {
          this.io.notifyWarning(
            `Prompt DB ignored ${result.dropped} invalid record(s). A backup of the original file was saved.`
          );
        }
      } catch (err) {
        this.io.notifyError(
          `Prompt DB loaded your prompts but could not save a cleaned copy: ${errorMessage(err)}`
        );
      }
    }
  }

  getAll(): Prompt[] {
    return this.prompts.map(p => ({ ...p }));
  }

  getCategories(): string[] {
    return [...new Set(this.prompts.map(p => p.category).filter(Boolean))].sort();
  }

  async add(data: FormFields): Promise<Prompt> {
    const prompt: Prompt = {
      id: newPromptId(),
      createdAt: Date.now(),
      name: data.name,
      body: data.body,
      category: data.category,
    };
    await this.commit([...this.prompts, prompt]);
    return prompt;
  }

  async update(id: string, data: FormFields): Promise<boolean> {
    const idx = this.prompts.findIndex(p => p.id === id);
    if (idx === -1) return false;
    const next = this.prompts.slice();
    next[idx] = { ...next[idx], ...data };
    await this.commit(next);
    return true;
  }

  async delete(id: string): Promise<boolean> {
    const next = this.prompts.filter(p => p.id !== id);
    if (next.length === this.prompts.length) return false;
    await this.commit(next);
    return true;
  }

  async replaceAll(prompts: Prompt[]): Promise<void> {
    await this.commit(prompts);
  }

  /** Write next state only after the file write succeeds. */
  private async commit(next: Prompt[]): Promise<void> {
    if (!this.storeReadable) {
      throw new Error(
        'The existing prompts file could not be read. Save aborted to avoid overwriting it.'
      );
    }
    await this.write(next);
    this.prompts = next;
  }

  private async write(prompts: Prompt[]): Promise<void> {
    await this.io.ensureDir();
    const buf = Buffer.from(JSON.stringify(prompts, null, 2), 'utf8');
    await this.io.writeFile('prompts.json.tmp', buf);
    await this.io.rename('prompts.json.tmp', 'prompts.json', true);
  }

  private async backupRaw(raw: Uint8Array): Promise<string> {
    await this.io.ensureDir();
    const backupName = `prompts.bak-${Date.now()}.json`;
    await this.io.writeFile(backupName, raw);
    return backupName;
  }

  private async quarantine(raw: Uint8Array, reason: string): Promise<void> {
    try {
      const backupName = await this.backupRaw(raw);
      try {
        await this.io.rename('prompts.json', `prompts.corrupt-${Date.now()}.json`, true);
      } catch {
        // Backup already saved; original may still be in place.
      }
      this.io.notifyError(
        `Prompt DB could not read your library (${reason}). A backup was saved as ${backupName}. Starting empty — the unreadable file was moved aside, not overwritten with an empty list.`
      );
    } catch (err) {
      this.storeReadable = false;
      this.io.notifyError(
        `Prompt DB could not read prompts.json (${reason}) and backing it up failed: ${errorMessage(err)}. Saving is disabled so the file will not be overwritten.`
      );
    }
  }
}

export function isFileNotFound(err: unknown): boolean {
  const code = (err as { code?: string }).code;
  return code === 'FileNotFound' || code === 'EntryNotFound' || code === 'ENOENT';
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
