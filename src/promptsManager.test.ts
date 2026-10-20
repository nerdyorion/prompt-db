import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PromptsManager, PromptStoreIO } from './promptsManager';
import { Prompt } from './types';

class MemoryIO implements PromptStoreIO {
  files = new Map<string, Uint8Array>();
  errors: string[] = [];
  warnings: string[] = [];
  readError: Error | undefined;

  async ensureDir(): Promise<void> {}

  async readFile(name: string): Promise<Uint8Array> {
    if (this.readError) throw this.readError;
    const data = this.files.get(name);
    if (!data) {
      const err = new Error('File not found') as Error & { code: string };
      err.code = 'FileNotFound';
      throw err;
    }
    return data;
  }

  async writeFile(name: string, data: Uint8Array): Promise<void> {
    this.files.set(name, data);
  }

  async rename(from: string, to: string, overwrite = false): Promise<void> {
    const data = this.files.get(from);
    if (!data) {
      const err = new Error('File not found') as Error & { code: string };
      err.code = 'FileNotFound';
      throw err;
    }
    if (!overwrite && this.files.has(to)) {
      throw new Error('exists');
    }
    this.files.set(to, data);
    this.files.delete(from);
  }

  notifyError(message: string): void {
    this.errors.push(message);
  }

  notifyWarning(message: string): void {
    this.warnings.push(message);
  }

  putJson(name: string, value: unknown): void {
    this.files.set(name, Buffer.from(JSON.stringify(value), 'utf8'));
  }

  readJson(name: string): unknown {
    const raw = this.files.get(name);
    if (!raw) return undefined;
    return JSON.parse(Buffer.from(raw).toString('utf8'));
  }

  names(): string[] {
    return [...this.files.keys()].sort();
  }
}

const sample: Prompt = {
  id: 'keep-me',
  name: 'Hello',
  body: 'world',
  category: 'greet',
  createdAt: 1,
};

describe('PromptsManager', () => {
  it('starts empty when prompts.json is missing and allows save', async () => {
    const io = new MemoryIO();
    const manager = new PromptsManager(io);
    await manager.load();
    assert.deepEqual(manager.getAll(), []);
    await manager.add({ name: 'N', body: 'B', category: '' });
    assert.equal(manager.getAll().length, 1);
    assert.equal(io.files.has('prompts.json'), true);
    assert.equal(io.files.has('prompts.json.tmp'), false);
  });

  it('loads a valid library without rewriting the file', async () => {
    const io = new MemoryIO();
    io.putJson('prompts.json', [sample]);
    const before = io.files.get('prompts.json');
    const manager = new PromptsManager(io);
    await manager.load();
    assert.deepEqual(manager.getAll(), [sample]);
    assert.equal(io.files.get('prompts.json'), before);
    assert.equal(io.names().some(n => n.startsWith('prompts.bak-')), false);
  });

  it('quarantines invalid JSON and then allows a new save', async () => {
    const io = new MemoryIO();
    io.files.set('prompts.json', Buffer.from('{not json', 'utf8'));
    const manager = new PromptsManager(io);
    await manager.load();
    assert.deepEqual(manager.getAll(), []);
    assert.ok(io.errors.some(m => m.includes('invalid JSON')));
    assert.ok(io.names().some(n => n.startsWith('prompts.bak-')));
    await manager.add({ name: 'Recovered', body: 'ok', category: '' });
    assert.equal(manager.getAll()[0].name, 'Recovered');
  });

  it('blocks save when the live file cannot be read', async () => {
    const io = new MemoryIO();
    io.readError = Object.assign(new Error('EIO'), { code: 'Unknown' });
    const manager = new PromptsManager(io);
    await manager.load();
    await assert.rejects(
      () => manager.add({ name: 'N', body: 'B', category: '' }),
      /could not be read/
    );
    assert.equal(io.files.has('prompts.json'), false);
  });

  it('quarantines a non-array store and keeps valid later writes', async () => {
    const io = new MemoryIO();
    io.putJson('prompts.json', { foo: 1 });
    const manager = new PromptsManager(io);
    await manager.load();
    assert.deepEqual(manager.getAll(), []);
    assert.ok(io.errors.some(m => m.includes('JSON array')));
  });

  it('getAll returns copies so callers cannot mutate storage', async () => {
    const io = new MemoryIO();
    io.putJson('prompts.json', [sample]);
    const manager = new PromptsManager(io);
    await manager.load();
    manager.getAll()[0].name = 'mutated';
    assert.equal(manager.getAll()[0].name, 'Hello');
  });

  it('update and delete persist after a successful write', async () => {
    const io = new MemoryIO();
    io.putJson('prompts.json', [sample]);
    const manager = new PromptsManager(io);
    await manager.load();
    assert.equal(
      await manager.update('keep-me', { name: 'Hi', body: 'there', category: 'greet' }),
      true
    );
    assert.equal(manager.getAll()[0].name, 'Hi');
    assert.equal((io.readJson('prompts.json') as Prompt[])[0].name, 'Hi');
    assert.equal(await manager.delete('keep-me'), true);
    assert.deepEqual(manager.getAll(), []);
    assert.deepEqual(io.readJson('prompts.json'), []);
  });

  it('cleans missing ids on load and writes a backup first', async () => {
    const io = new MemoryIO();
    io.putJson('prompts.json', [{ name: 'NoId', body: 'x', category: '' }]);
    const manager = new PromptsManager(io);
    await manager.load();
    const loaded = manager.getAll();
    assert.equal(loaded.length, 1);
    assert.ok(loaded[0].id);
    assert.ok(io.names().some(n => n.startsWith('prompts.bak-')));
    assert.equal((io.readJson('prompts.json') as Prompt[])[0].id, loaded[0].id);
  });
});
