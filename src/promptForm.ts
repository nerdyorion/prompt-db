import * as vscode from 'vscode';
import { Prompt } from './types';
import { FormFields, sanitizeForm } from './promptCodec';

export type FormResult = FormFields;

export function openPromptForm(
  context: vscode.ExtensionContext,
  categories: string[],
  initial?: Prompt
): Promise<FormResult | undefined> {
  return new Promise(resolve => {
    const title = initial ? 'Edit Prompt' : 'New Prompt';
    const panel = vscode.window.createWebviewPanel(
      'promptdbForm',
      title,
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    const nonce = getNonce();
    panel.webview.html = buildHtml(title, categories, initial, nonce);

    let resolved = false;
    const finish = (value: FormResult | undefined) => {
      if (resolved) return;
      resolved = true;
      panel.dispose();
      resolve(value);
    };

    const incoming = panel.webview.onDidReceiveMessage((msg: { type?: string; data?: unknown }) => {
      if (resolved) return;
      if (msg?.type === 'submit') {
        const data = sanitizeForm(msg.data);
        if (!data) return;
        finish(data);
      } else if (msg?.type === 'cancel') {
        finish(undefined);
      }
    });

    panel.onDidDispose(() => {
      incoming.dispose();
      if (!resolved) resolve(undefined);
    });

    context.subscriptions.push(panel);
  });
}

function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function getNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) text += chars.charAt(Math.floor(Math.random() * chars.length));
  return text;
}

function buildHtml(title: string, categories: string[], initial: Prompt | undefined, nonce: string): string {
  const esc = (s = '') => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const catOptions = categories
    .map(c => `<option value="${esc(c)}"${initial?.category === c ? ' selected' : ''}>${esc(c)}</option>`)
    .join('');

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    padding: 24px 28px;
    max-width: 720px;
  }

  h1 {
    font-size: 1.2em;
    font-weight: 600;
    margin-bottom: 20px;
    color: var(--vscode-foreground);
  }

  .field { margin-bottom: 16px; }

  label {
    display: block;
    font-size: 0.85em;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--vscode-descriptionForeground);
    margin-bottom: 5px;
  }

  label span { color: var(--vscode-errorForeground); margin-left: 2px; }

  input[type="text"], select, textarea {
    width: 100%;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 3px;
    padding: 7px 10px;
    font-family: inherit;
    font-size: inherit;
    outline: none;
    transition: border-color 0.15s;
  }

  input[type="text"]:focus, select:focus, textarea:focus {
    border-color: var(--vscode-focusBorder);
  }

  textarea {
    resize: vertical;
    min-height: 220px;
    line-height: 1.5;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: var(--vscode-editor-font-size, 13px);
  }

  .category-row { display: flex; gap: 8px; align-items: center; }
  .category-row input { flex: 1; }
  .category-row select { flex: 1; }

  .error { color: var(--vscode-errorForeground); font-size: 0.82em; margin-top: 4px; display: none; }
  .field.invalid .error { display: block; }
  .field.invalid input, .field.invalid textarea { border-color: var(--vscode-errorForeground); }

  .actions {
    display: flex;
    gap: 10px;
    margin-top: 22px;
  }

  button {
    padding: 7px 18px;
    border: none;
    border-radius: 3px;
    font-family: inherit;
    font-size: inherit;
    cursor: pointer;
    font-weight: 500;
  }

  .btn-primary {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }
  .btn-primary:hover { background: var(--vscode-button-hoverBackground); }

  .btn-secondary {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
  }
  .btn-secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }

  .char-count {
    font-size: 0.78em;
    color: var(--vscode-descriptionForeground);
    text-align: right;
    margin-top: 3px;
  }
</style>
</head>
<body>
<h1>${esc(title)}</h1>

<div class="field" id="field-name">
  <label>Name <span>*</span></label>
  <input type="text" id="name" value="${esc(initial?.name)}" placeholder="e.g. Write unit tests" autocomplete="off">
  <div class="error">Name is required</div>
</div>

<div class="field" id="field-category">
  <label>Category</label>
  <div class="category-row">
    ${categories.length
      ? `<select id="cat-select">
          <option value="">— None —</option>
          ${catOptions}
          <option value="__new__">+ New category…</option>
        </select>`
      : ''}
    <input type="text" id="cat-input" placeholder="Category name (optional)"
      style="${categories.length ? 'display:none' : ''}"
      value="${esc(initial?.category)}">
  </div>
</div>

<div class="field" id="field-body">
  <label>Prompt body <span>*</span></label>
  <textarea id="body" placeholder="Type your prompt here…">${esc(initial?.body)}</textarea>
  <div class="char-count"><span id="char-count">0</span> characters</div>
  <div class="error">Prompt body is required</div>
</div>

<div class="actions">
  <button class="btn-primary" id="btn-save">Save</button>
  <button class="btn-secondary" id="btn-cancel">Cancel</button>
</div>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();

  const nameEl = document.getElementById('name');
  const bodyEl = document.getElementById('body');
  const charCount = document.getElementById('char-count');
  const catSelect = document.getElementById('cat-select');
  const catInput = document.getElementById('cat-input');

  // Live char count
  function updateCount() {
    charCount.textContent = bodyEl.value.length;
  }
  bodyEl.addEventListener('input', updateCount);
  updateCount();

  // Category toggle (existing categories case)
  if (catSelect) {
    catSelect.addEventListener('change', () => {
      if (catSelect.value === '__new__') {
        catSelect.style.display = 'none';
        catInput.style.display = '';
        catInput.value = '';
        catInput.focus();
      }
    });
    catInput.addEventListener('blur', () => {
      if (!catInput.value.trim()) {
        catInput.style.display = 'none';
        catSelect.style.display = '';
        catSelect.value = '';
      }
    });
    // Pre-select current category
    const current = ${jsonForScript(initial?.category ?? '')};
    if (current && catSelect) {
      const opt = [...catSelect.options].find(o => o.value === current);
      if (opt) catSelect.value = current;
      else {
        // Category not in list — show as text
        catInput.value = current;
        catInput.style.display = '';
        catSelect.style.display = 'none';
      }
    }
  }

  function getCategory() {
    if (catInput && catInput.style.display !== 'none') return catInput.value.trim();
    if (catSelect && catSelect.value !== '__new__') return catSelect.value;
    return '';
  }

  function validate() {
    let ok = true;
    const nameField = document.getElementById('field-name');
    const bodyField = document.getElementById('field-body');
    nameField.classList.remove('invalid');
    bodyField.classList.remove('invalid');
    if (!nameEl.value.trim()) { nameField.classList.add('invalid'); ok = false; }
    if (!bodyEl.value.trim()) { bodyField.classList.add('invalid'); ok = false; }
    return ok;
  }

  document.getElementById('btn-save').addEventListener('click', () => {
    if (!validate()) return;
    vscode.postMessage({
      type: 'submit',
      data: {
        name: nameEl.value.trim(),
        body: bodyEl.value,
        category: getCategory(),
      }
    });
  });

  document.getElementById('btn-cancel').addEventListener('click', () => {
    vscode.postMessage({ type: 'cancel' });
  });

  // Ctrl/Cmd+Enter to save
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      document.getElementById('btn-save').click();
    }
    if (e.key === 'Escape') {
      document.getElementById('btn-cancel').click();
    }
  });

  nameEl.focus();
</script>
</body>
</html>`;
}
