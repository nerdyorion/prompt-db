import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeImported,
  normalizePrompt,
  parsePromptStore,
  sanitizeForm,
} from './promptCodec';

describe('normalizePrompt', () => {
  it('keeps an existing id', () => {
    const p = normalizePrompt({
      id: 'keep-me',
      name: 'N',
      body: 'hello',
      category: 'c',
      createdAt: 1,
    });
    assert.equal(p?.id, 'keep-me');
    assert.equal(p?.body, 'hello');
  });

  it('rejects missing name or empty body', () => {
    assert.equal(normalizePrompt({ name: '', body: 'x' }), undefined);
    assert.equal(normalizePrompt({ name: 'n', body: '   ' }), undefined);
    assert.equal(normalizePrompt('nope'), undefined);
  });

  it('does not trim prompt body', () => {
    const p = normalizePrompt({ id: '1', name: ' n ', body: '\nkeep\n' });
    assert.equal(p?.name, 'n');
    assert.equal(p?.body, '\nkeep\n');
  });
});

describe('parsePromptStore', () => {
  it('reads a legacy array without rewriting ids', () => {
    const result = parsePromptStore([
      { id: 'a', name: 'One', body: 'aaa', category: '', createdAt: 1 },
      { id: 'b', name: 'Two', body: 'bbb', category: 'x', createdAt: 2 },
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.migrated, false);
    assert.equal(result.dropped, 0);
    assert.deepEqual(result.prompts.map(p => p.id), ['a', 'b']);
  });

  it('reads wrapped { prompts } files', () => {
    const result = parsePromptStore({
      prompts: [{ id: 'z', name: 'Z', body: 'zz' }],
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.prompts[0].id, 'z');
  });

  it('rejects non-array JSON', () => {
    const result = parsePromptStore({ foo: 1 });
    assert.equal(result.ok, false);
  });

  it('drops invalid rows and keeps valid ones', () => {
    const result = parsePromptStore([
      { id: 'ok', name: 'Good', body: 'yes' },
      { id: 'bad', name: '', body: 'no' },
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.prompts.length, 1);
    assert.equal(result.dropped, 1);
    assert.equal(result.prompts[0].id, 'ok');
  });

  it('assigns a new id when the same file repeats an id', () => {
    const result = parsePromptStore([
      { id: 'dup', name: 'First', body: 'one' },
      { id: 'dup', name: 'Second', body: 'two' },
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.migrated, true);
    assert.equal(result.prompts[0].id, 'dup');
    assert.notEqual(result.prompts[1].id, 'dup');
    assert.equal(result.prompts[1].name, 'Second');
  });
});

describe('mergeImported', () => {
  it('keeps original ids, updates same-id rows, and appends new ones', () => {
    const existing = [
      { id: 'a', name: 'A', body: 'a', category: '', createdAt: 1 },
    ];
    const incoming = [
      { id: 'a', name: 'A again', body: 'a', category: '', createdAt: 1 },
      { id: 'b', name: 'B', body: 'b', category: '', createdAt: 2 },
    ];
    const { prompts, added, skipped, updated } = mergeImported(existing, incoming);
    assert.equal(added, 1);
    assert.equal(skipped, 0);
    assert.equal(updated, 1);
    assert.deepEqual(prompts.map(p => p.id), ['a', 'b']);
    assert.equal(prompts[0].name, 'A again');
    assert.equal(prompts[0].createdAt, 1);
    assert.equal(prompts[1].name, 'B');
  });

  it('does not duplicate when the same file is merged twice', () => {
    const file = [
      { id: 'x', name: 'X', body: 'x', category: '', createdAt: 1 },
    ];
    const once = mergeImported([], file);
    const twice = mergeImported(once.prompts, file);
    assert.equal(once.added, 1);
    assert.equal(twice.added, 0);
    assert.equal(twice.updated, 0);
    assert.equal(twice.skipped, 1);
    assert.equal(twice.prompts.length, 1);
  });

  it('skips id-less copies that match name, category, and body', () => {
    const existing = [
      { id: 'a', name: 'Same', body: 'text', category: '', createdAt: 1 },
    ];
    const incoming = [
      { id: 'generated', name: 'Same', body: 'text', category: '', createdAt: 9 },
    ];
    const { added, skipped, prompts } = mergeImported(existing, incoming);
    assert.equal(added, 0);
    assert.equal(skipped, 1);
    assert.equal(prompts.length, 1);
  });
});

describe('sanitizeForm', () => {
  it('requires name and non-whitespace body, keeps body padding', () => {
    assert.equal(sanitizeForm({ name: ' ', body: 'x' }), undefined);
    const ok = sanitizeForm({ name: ' T ', body: '\nbody\n', category: ' c ' });
    assert.deepEqual(ok, { name: 'T', body: '\nbody\n', category: 'c' });
  });
});
