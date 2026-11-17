import { Prompt } from './types';

export function newPromptId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export function normalizePrompt(raw: unknown): Prompt | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  if (typeof o.name !== 'string' || !o.name.trim()) return undefined;
  if (typeof o.body !== 'string' || !o.body.trim()) return undefined;

  const id = typeof o.id === 'string' && o.id.trim() ? o.id : newPromptId();
  const category = typeof o.category === 'string' ? o.category : '';
  const createdAt =
    typeof o.createdAt === 'number' && Number.isFinite(o.createdAt)
      ? o.createdAt
      : Date.now();

  return {
    id,
    name: o.name.trim(),
    body: o.body,
    category,
    createdAt,
  };
}

export type ParseOk = {
  ok: true;
  prompts: Prompt[];
  /** True when IDs were filled or duplicate IDs in the file were rewritten. */
  migrated: boolean;
  dropped: number;
};

export type ParseFail = { ok: false; reason: string };

export type ParseResult = ParseOk | ParseFail;

/**
 * Accepts the on-disk format (a JSON array of prompts) and the wrapped
 * `{ prompts: [...] }` shape. Existing IDs are kept. A second row that
 * reuses an ID in the same file gets a new ID so delete/update stay unique.
 */
export function parsePromptStore(parsed: unknown): ParseResult {
  let list: unknown[];
  if (Array.isArray(parsed)) {
    list = parsed;
  } else if (
    parsed &&
    typeof parsed === 'object' &&
    Array.isArray((parsed as { prompts?: unknown }).prompts)
  ) {
    list = (parsed as { prompts: unknown[] }).prompts;
  } else {
    return { ok: false, reason: 'Prompt store must be a JSON array of prompts.' };
  }

  const prompts: Prompt[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  let migrated = false;

  for (const item of list) {
    const hadId =
      !!item &&
      typeof item === 'object' &&
      typeof (item as { id?: unknown }).id === 'string' &&
      (item as { id: string }).id.trim().length > 0;

    const normalized = normalizePrompt(item);
    if (!normalized) {
      dropped++;
      continue;
    }

    if (!hadId) migrated = true;

    while (seen.has(normalized.id)) {
      normalized.id = newPromptId();
      migrated = true;
    }
    seen.add(normalized.id);
    prompts.push(normalized);
  }

  return { ok: true, prompts, migrated, dropped };
}

export interface FormFields {
  name: string;
  body: string;
  category: string;
}

/** Extension-side check for webview submit payloads. Keeps body whitespace. */
export function sanitizeForm(data: unknown): FormFields | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const o = data as Record<string, unknown>;
  if (typeof o.name !== 'string' || typeof o.body !== 'string') return undefined;
  const name = o.name.trim();
  const category = typeof o.category === 'string' ? o.category.trim() : '';
  if (!name || !o.body.trim()) return undefined;
  return { name, body: o.body, category };
}

export function escapeMarkdown(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/[\\`*_{}[\]()#+\-.!|]/g, '\\$&');
}

function fingerprint(p: Prompt): string {
  return `${p.name}\n${p.category}\n${p.body}`;
}

export function mergeImported(
  existing: Prompt[],
  incoming: Prompt[]
): { prompts: Prompt[]; added: number; skipped: number; updated: number } {
  const byId = new Map<string, Prompt>();
  for (const p of existing) byId.set(p.id, { ...p });
  const prints = new Set(existing.map(fingerprint));
  let added = 0;
  let skipped = 0;
  let updated = 0;

  for (const prompt of incoming) {
    const prev = byId.get(prompt.id);
    if (prev) {
      const next: Prompt = {
        ...prev,
        name: prompt.name,
        body: prompt.body,
        category: prompt.category,
      };
      if (fingerprint(next) === fingerprint(prev)) {
        skipped++;
      } else {
        prints.delete(fingerprint(prev));
        prints.add(fingerprint(next));
        byId.set(prompt.id, next);
        updated++;
      }
      continue;
    }

    const fp = fingerprint(prompt);
    if (prints.has(fp)) {
      skipped++;
      continue;
    }

    byId.set(prompt.id, prompt);
    prints.add(fp);
    added++;
  }

  return {
    prompts: [...byId.values()],
    added,
    skipped,
    updated,
  };
}
