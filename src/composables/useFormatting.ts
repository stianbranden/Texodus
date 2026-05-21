/**
 * Markdown formatting helpers for the editor textarea.
 * Used by both KeyboardShortcuts and Toolbar via App.vue.
 */
import { nextTick } from 'vue';
import { useEditorStore } from '../stores/editor';

async function wrapSelection(
  textarea: HTMLTextAreaElement,
  before: string,
  after: string,
  defaultText = ''
): Promise<void> {
  const store = useEditorStore();
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const content = store.content;
  const selected = content.substring(start, end) || defaultText;
  const savedScroll = textarea.scrollTop;

  store.updateContent(
    content.substring(0, start) + before + selected + after + content.substring(end)
  );

  await nextTick();
  textarea.scrollTop = savedScroll;
  textarea.focus();
  const newStart = start + before.length;
  textarea.setSelectionRange(newStart, newStart + selected.length);
}

async function prependLine(textarea: HTMLTextAreaElement, prefix: string): Promise<void> {
  const store = useEditorStore();
  const start = textarea.selectionStart;
  const content = store.content;
  const lineStart = content.lastIndexOf('\n', start - 1) + 1;
  const savedScroll = textarea.scrollTop;

  store.updateContent(content.substring(0, lineStart) + prefix + content.substring(lineStart));

  await nextTick();
  textarea.scrollTop = savedScroll;
  textarea.focus();
  const cursor = start + prefix.length;
  textarea.setSelectionRange(cursor, cursor);
}

export function applyFormat(format: string, textarea: HTMLTextAreaElement | null): void {
  if (!textarea) return;
  switch (format) {
    case 'bold':          wrapSelection(textarea, '**', '**', 'bold text'); break;
    case 'italic':        wrapSelection(textarea, '*', '*', 'italic text'); break;
    case 'underline':     wrapSelection(textarea, '<u>', '</u>', 'underline text'); break;
    case 'strikethrough': wrapSelection(textarea, '~~', '~~', 'strikethrough'); break;
    case 'link':          wrapSelection(textarea, '[', '](https://)', 'link text'); break;
    case 'image':         wrapSelection(textarea, '![', '](https://)', 'image description'); break;
    case 'table':         wrapSelection(textarea, '\n| Column 1 | Column 2 |\n| -------- | -------- |\n| Text     | Text     |\n', '', ''); break;
    case 'list':          prependLine(textarea, '- '); break;
    case 'ordered_list':  prependLine(textarea, '1. '); break;
    case 'task_list':     prependLine(textarea, '- [ ] '); break;
    case 'blockquote':    prependLine(textarea, '> '); break;
    case 'code':          wrapSelection(textarea, '`', '`', 'code'); break;
    case 'block_code':    wrapSelection(textarea, '\n```\n', '\n```\n', 'code block'); break;
    case 'inline_math':   wrapSelection(textarea, '$', '$', 'x'); break;
    case 'block_math':    wrapSelection(textarea, '\n$$\n', '\n$$\n', 'x = y'); break;
    case 'heading1':      prependLine(textarea, '# '); break;
    case 'heading2':      prependLine(textarea, '## '); break;
    case 'heading3':      prependLine(textarea, '### '); break;
    case 'heading4':      prependLine(textarea, '#### '); break;
    case 'heading5':      prependLine(textarea, '##### '); break;
    case 'heading6':      prependLine(textarea, '###### '); break;
    case 'heading':       prependLine(textarea, '## '); break; // Legacy fallback
    case 'paragraph':     wrapSelection(textarea, '\n\n', '', ''); break;
    case 'horizontal_rule': wrapSelection(textarea, '\n\n---\n\n', '', ''); break;
  }
}
