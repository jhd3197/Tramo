/**
 * VarRichField — contentEditable text field that renders `{{path}}`
 * template tokens as inline chip elements while preserving the raw
 * template string as the backing value.
 *
 * Used by NodeInspector in place of plain <input>/<textarea> for any
 * field that renders templates at runtime (text, textarea, url). The
 * `code` field type still uses a raw textarea — JS expressions don't
 * carry {{}} markers and chips would just get in the way.
 *
 * Caret rules:
 *   - Chips are atomic. Backspace at the right edge of a chip removes
 *     the whole chip in one stroke.
 *   - Picker insertions land at the current caret; we then collapse to
 *     just-after the new chip.
 *   - Single-line mode swallows Enter and pasted newlines.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ClipboardEvent,
} from 'react';
import { Braces } from 'lucide-react';
import { VarPicker } from './VarPicker.js';
import type { VarSuggestion } from './varSuggestions.js';

const VAR_RE = /\{\{\s*([^}]+?)\s*\}\}/g;

export interface VarRichFieldProps {
  value: string;
  onLocalChange: (next: string) => void;
  onCommit: (next: string) => void;
  suggestions: VarSuggestion[];
  multiline?: boolean;
  className?: string;
  placeholder?: string;
  id?: string;
  ariaLabel?: string;
  rows?: number;
}

export function VarRichField({
  value,
  onLocalChange,
  onCommit,
  suggestions,
  multiline = false,
  className,
  placeholder,
  id,
  ariaLabel,
  rows,
}: VarRichFieldProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  /** What we last serialized FROM the DOM. Lets us short-circuit the
   *  external→DOM sync when the change originated here. */
  const lastSerialized = useRef<string>(value);
  const [focused, setFocused] = useState(false);
  const [empty, setEmpty] = useState(value.length === 0);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerAnchor, setPickerAnchor] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  const [pickerQuery, setPickerQuery] = useState('');
  /** When the picker opens via slash, this tracks where the slash sits in
   *  the *current selection* so we can delete `/query` on pick. Stored as
   *  a serialized offset because DOM mutations would invalidate a Range. */
  const slashStateRef = useRef<{ startOffset: number; caretOffset: number } | null>(null);

  // Mount-time render of the initial value.
  useLayoutEffect(() => {
    if (!ref.current) return;
    paintValue(ref.current, value);
    lastSerialized.current = value;
    setEmpty(value.length === 0);
    // We intentionally only render on mount + when value diverges; see effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // External value changes (e.g. node switched) → repaint, but only when
  // the incoming value differs from what we last serialized. Avoids
  // wiping the caret while the user is typing.
  useEffect(() => {
    if (!ref.current) return;
    if (value === lastSerialized.current) return;
    paintValue(ref.current, value);
    lastSerialized.current = value;
    setEmpty(value.length === 0);
  }, [value]);

  const closePicker = useCallback(() => {
    setPickerOpen(false);
    setPickerQuery('');
    slashStateRef.current = null;
  }, []);

  const measureAnchor = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const PICKER_W = 380;
    const MARGIN = 12;
    const maxLeft = Math.max(MARGIN, window.innerWidth - PICKER_W - MARGIN);
    const left = Math.min(Math.max(r.left, MARGIN), maxLeft);
    setPickerAnchor({ left, top: r.bottom + 4 });
  }, []);

  const handleInput = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const next = serialize(el);
    if (next === lastSerialized.current) return;
    lastSerialized.current = next;
    onLocalChange(next);
    const isEmpty = next.length === 0;
    setEmpty(isEmpty);
    // Browsers leave a stray <br> when the user backspaces the last char,
    // which breaks our :empty placeholder selector. Strip it.
    if (isEmpty && el.firstChild) el.innerHTML = '';

    // Slash detection: caret in a text node, character just behind it is
    // `/`, and the char before that is whitespace or start-of-field.
    if (!pickerOpen) {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      const node = range.endContainer;
      if (node.nodeType !== Node.TEXT_NODE) return;
      const offset = range.endOffset;
      const text = node.textContent ?? '';
      if (text[offset - 1] !== '/') return;
      const prev = offset >= 2 ? text[offset - 2] : ' ';
      const atStart =
        offset === 1 &&
        // No text content before this node within the editable
        getTextOffset(el, node, 0) === 0;
      const ok =
        suggestions.length > 0 &&
        (atStart || prev === ' ' || prev === '\n' || prev === '\t');
      if (!ok) return;
      const slashGlobal = getTextOffset(el, node, offset - 1);
      slashStateRef.current = {
        startOffset: slashGlobal,
        caretOffset: slashGlobal + 1,
      };
      setPickerOpen(true);
      setPickerQuery('');
      measureAnchor();
      return;
    }

    // Picker open via slash — track filter query (text between slash + caret).
    if (slashStateRef.current) {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      const node = range.endContainer;
      if (node.nodeType !== Node.TEXT_NODE) {
        closePicker();
        return;
      }
      const caretGlobal = getTextOffset(el, node, range.endOffset);
      const { startOffset } = slashStateRef.current;
      if (caretGlobal <= startOffset) {
        closePicker();
        return;
      }
      // Read the characters in the editable between slash and caret.
      const segment = readPlainTextRange(el, startOffset + 1, caretGlobal);
      if (segment.includes(' ') || segment.includes('\n') || segment.includes('/')) {
        closePicker();
        return;
      }
      slashStateRef.current = { startOffset, caretOffset: caretGlobal };
      setPickerQuery(segment);
    }
  }, [onLocalChange, pickerOpen, suggestions.length, measureAnchor, closePicker]);

  const handleBlur = useCallback(() => {
    setFocused(false);
    if (pickerOpen) return; // pick handler will commit
    onCommit(lastSerialized.current);
  }, [onCommit, pickerOpen]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (pickerOpen) {
        // Picker swallows nav keys; we only need to keep our caret stable.
        if (
          e.key === 'ArrowDown' ||
          e.key === 'ArrowUp' ||
          e.key === 'Enter' ||
          e.key === 'Tab' ||
          e.key === 'Escape'
        ) {
          e.preventDefault();
        }
      }

      if (!multiline && e.key === 'Enter') {
        e.preventDefault();
        (e.currentTarget as HTMLElement).blur();
        return;
      }

      // Atomic chip deletion. Native contentEditable already treats chips
      // (contenteditable=false) as single units in most browsers, but the
      // chrome behaviour on first backspace is sometimes "select", not
      // "delete". Force a one-step delete when the caret is just after a
      // chip.
      if (e.key === 'Backspace') {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return;
        const range = sel.getRangeAt(0);
        const before = previousChipAtCaret(range);
        if (before) {
          e.preventDefault();
          before.remove();
          // Schedule serialization on the next frame so the DOM is settled.
          requestAnimationFrame(() => handleInput());
        }
      }
    },
    [multiline, pickerOpen, handleInput],
  );

  const handlePaste = useCallback(
    (e: ClipboardEvent<HTMLDivElement>) => {
      e.preventDefault();
      const text = e.clipboardData.getData('text/plain');
      const cleaned = multiline ? text : text.replace(/\r?\n/g, ' ');
      insertSerializedAtCaret(ref.current!, cleaned);
      handleInput();
    },
    [multiline, handleInput],
  );

  const openPickerFromButton = useCallback(() => {
    if (pickerOpen) {
      closePicker();
      return;
    }
    if (suggestions.length === 0) return;
    // Caret-at-end if focus has been lost.
    const el = ref.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (sel && sel.rangeCount === 0) {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      sel.addRange(range);
    }
    slashStateRef.current = null;
    setPickerQuery('');
    setPickerOpen(true);
    measureAnchor();
  }, [pickerOpen, suggestions.length, closePicker, measureAnchor]);

  const pickSuggestion = useCallback(
    (s: VarSuggestion) => {
      const el = ref.current;
      if (!el) {
        closePicker();
        return;
      }
      el.focus();

      // If opened via slash, remove the `/query` first.
      if (slashStateRef.current) {
        const { startOffset, caretOffset } = slashStateRef.current;
        deletePlainTextRange(el, startOffset, caretOffset);
      }

      insertChipAtCaret(el, s.path);
      const next = serialize(el);
      lastSerialized.current = next;
      onLocalChange(next);
      onCommit(next);
      setEmpty(next.length === 0);
      closePicker();
    },
    [onLocalChange, onCommit, closePicker],
  );

  const containerClass = useMemo(() => {
    return [
      'tr-rich',
      multiline ? 'tr-rich--area' : 'tr-rich--line',
      focused ? 'is-focused' : '',
      empty ? 'is-empty' : '',
      className ?? '',
    ]
      .filter(Boolean)
      .join(' ');
  }, [multiline, focused, empty, className]);

  const editorStyle: CSSProperties | undefined =
    multiline && rows ? { minHeight: `${rows * 1.45 + 0.6}em` } : undefined;

  return (
    <div className="tr-rich-wrap">
      <div className={containerClass}>
        <div
          ref={ref}
          id={id}
          className="tr-rich__editor"
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline={multiline}
          aria-label={ariaLabel}
          spellCheck={!multiline ? false : undefined}
          data-placeholder={placeholder}
          style={editorStyle}
          onInput={handleInput}
          onFocus={() => setFocused(true)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
        />
        <button
          type="button"
          className="tr-rich__btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={openPickerFromButton}
          disabled={suggestions.length === 0}
          title={
            suggestions.length === 0
              ? 'Connect an upstream node or add a Set Variable to use variables here.'
              : 'Insert a variable'
          }
          aria-label="Insert variable"
        >
          <Braces size={12} strokeWidth={2.4} aria-hidden />
          <span>var</span>
        </button>
      </div>
      {pickerOpen ? (
        <VarPicker
          suggestions={suggestions}
          anchor={pickerAnchor}
          query={pickerQuery}
          onPick={pickSuggestion}
          onClose={closePicker}
        />
      ) : null}
    </div>
  );
}

/* ============================================================
   DOM helpers
   ============================================================ */

/** Render the backing string into the editor div, replacing children. */
function paintValue(root: HTMLDivElement, value: string): void {
  root.innerHTML = '';
  if (!value) return;
  VAR_RE.lastIndex = 0;
  let last = 0;
  for (const m of value.matchAll(VAR_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) appendText(root, value.slice(last, idx));
    root.appendChild(buildChip(m[1]));
    last = idx + m[0].length;
  }
  if (last < value.length) appendText(root, value.slice(last));
}

/** Walk the editor and reproduce the backing string from the DOM. */
function serialize(root: HTMLDivElement): string {
  const parts: string[] = [];
  walk(root, parts);
  return parts.join('');
}

function walk(node: Node, parts: string[]): void {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      parts.push(child.textContent ?? '');
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const el = child as HTMLElement;
    if (el.dataset.varPath) {
      parts.push(`{{${el.dataset.varPath}}}`);
      continue;
    }
    if (el.tagName === 'BR') {
      parts.push('\n');
      continue;
    }
    // Browsers (Chrome/Edge) wrap new lines in <div>. Treat each as a new line
    // unless it's the very first block child.
    if (el.tagName === 'DIV' || el.tagName === 'P') {
      if (parts.length > 0 && !parts[parts.length - 1]!.endsWith('\n')) {
        parts.push('\n');
      }
      walk(el, parts);
      continue;
    }
    // Anything else: fall through to its children. Strips formatting from
    // pasted-and-cleaned text but keeps the readable string.
    walk(el, parts);
  }
}

function buildChip(path: string): HTMLSpanElement {
  const chip = document.createElement('span');
  chip.className = 'tr-var-pill';
  chip.contentEditable = 'false';
  chip.dataset.varPath = path;
  chip.title = `{{${path}}}`;

  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('width', '11');
  icon.setAttribute('height', '11');
  icon.setAttribute('fill', 'none');
  icon.setAttribute('stroke', 'currentColor');
  icon.setAttribute('stroke-width', '2.6');
  icon.setAttribute('stroke-linecap', 'round');
  icon.setAttribute('stroke-linejoin', 'round');
  icon.setAttribute('aria-hidden', 'true');
  icon.classList.add('tr-var-pill__icon');
  const p1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p1.setAttribute('d', 'M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1');
  const p2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p2.setAttribute('d', 'M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1');
  icon.appendChild(p1);
  icon.appendChild(p2);
  chip.appendChild(icon);

  const name = document.createElement('span');
  name.className = 'tr-var-pill__name';
  name.textContent = displayName(path);
  chip.appendChild(name);

  return chip;
}

function displayName(path: string): string {
  // `vars.NAME` → NAME; `steps.fetch.user.name` → name; bare → as-is.
  const last = path.split('.').pop() ?? path;
  return last || path;
}

function appendText(root: HTMLDivElement, text: string): void {
  if (!text) return;
  // Preserve newlines via <br> when present.
  if (!text.includes('\n')) {
    root.appendChild(document.createTextNode(text));
    return;
  }
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    if (line) root.appendChild(document.createTextNode(line));
    if (i < lines.length - 1) root.appendChild(document.createElement('br'));
  });
}

/** Plain-text offset of (node, offset) relative to root. Skips chip
 *  contents — chips contribute one synthetic character of length 0 to
 *  plain-text positions since we only use these offsets for slash-state
 *  tracking inside contiguous text. */
function getTextOffset(root: HTMLDivElement, node: Node, offset: number): number {
  let total = 0;
  let found = false;
  const walker = (n: Node) => {
    if (found) return;
    if (n === node) {
      total += offset;
      found = true;
      return;
    }
    if (n.nodeType === Node.TEXT_NODE) {
      total += (n.textContent ?? '').length;
      return;
    }
    if (n.nodeType === Node.ELEMENT_NODE) {
      const el = n as HTMLElement;
      if (el.dataset.varPath) return; // skip chip's text
      if (el.tagName === 'BR') {
        total += 1;
        return;
      }
      for (const child of Array.from(el.childNodes)) walker(child);
    }
  };
  for (const child of Array.from(root.childNodes)) walker(child);
  return total;
}

function readPlainTextRange(root: HTMLDivElement, from: number, to: number): string {
  let total = 0;
  let out = '';
  const walker = (n: Node) => {
    if (total >= to) return;
    if (n.nodeType === Node.TEXT_NODE) {
      const t = n.textContent ?? '';
      const start = Math.max(0, from - total);
      const end = Math.min(t.length, to - total);
      if (end > start) out += t.slice(start, end);
      total += t.length;
      return;
    }
    if (n.nodeType === Node.ELEMENT_NODE) {
      const el = n as HTMLElement;
      if (el.dataset.varPath) return;
      if (el.tagName === 'BR') {
        if (total >= from && total < to) out += '\n';
        total += 1;
        return;
      }
      for (const child of Array.from(el.childNodes)) walker(child);
    }
  };
  for (const child of Array.from(root.childNodes)) walker(child);
  return out;
}

/** Delete a contiguous plain-text range from the editor. Splits/joins
 *  text nodes as needed. Skips any chip elements inside the range. */
function deletePlainTextRange(root: HTMLDivElement, from: number, to: number): void {
  if (from >= to) return;
  let total = 0;
  // Snapshot first because we mutate during iteration.
  const nodes: Node[] = [];
  const collect = (n: Node) => {
    if (n.nodeType === Node.TEXT_NODE) {
      nodes.push(n);
      return;
    }
    if (n.nodeType === Node.ELEMENT_NODE) {
      const el = n as HTMLElement;
      if (el.dataset.varPath) {
        nodes.push(n);
        return;
      }
      if (el.tagName === 'BR') {
        nodes.push(n);
        return;
      }
      for (const child of Array.from(el.childNodes)) collect(child);
    }
  };
  for (const child of Array.from(root.childNodes)) collect(child);

  let restoreCaret: { node: Text; offset: number } | null = null;
  for (const n of nodes) {
    if (total >= to) break;
    if (n.nodeType === Node.TEXT_NODE) {
      const t = n as Text;
      const len = t.length;
      const a = Math.max(0, from - total);
      const b = Math.min(len, to - total);
      if (b > a) {
        t.deleteData(a, b - a);
        if (!restoreCaret) restoreCaret = { node: t, offset: a };
      }
      total += len;
      continue;
    }
    if (n.nodeType === Node.ELEMENT_NODE) {
      const el = n as HTMLElement;
      if (el.dataset.varPath) continue; // chips count as 0, skip
      if (el.tagName === 'BR') {
        if (total >= from && total < to) {
          el.remove();
        }
        total += 1;
      }
    }
  }
  if (restoreCaret) {
    const sel = window.getSelection();
    if (sel) {
      const range = document.createRange();
      range.setStart(restoreCaret.node, restoreCaret.offset);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }
}

/** Insert a chip element at the current selection, replacing any selected
 *  range. Caret is collapsed just after the inserted chip. */
function insertChipAtCaret(root: HTMLDivElement, path: string): void {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) {
    const chip = buildChip(path);
    root.appendChild(chip);
    return;
  }
  let range = sel.getRangeAt(0);
  // Ensure the range is inside the editor.
  if (!root.contains(range.startContainer)) {
    range = document.createRange();
    range.selectNodeContents(root);
    range.collapse(false);
  }
  range.deleteContents();
  const chip = buildChip(path);
  range.insertNode(chip);

  // Move caret to just after the chip, inserting a trailing space when
  // the next sibling is missing or another chip. Makes the next typed
  // character read as plain text rather than slotting into the chip.
  const after = chip.nextSibling;
  let caretNode: Node;
  let caretOffset: number;
  if (
    !after ||
    (after.nodeType === Node.ELEMENT_NODE && (after as HTMLElement).dataset.varPath)
  ) {
    const space = document.createTextNode(' '); // nbsp keeps it visible
    chip.parentNode!.insertBefore(space, after);
    caretNode = space;
    caretOffset = 1;
  } else {
    caretNode = chip.parentNode!;
    caretOffset = Array.from(chip.parentNode!.childNodes).indexOf(chip) + 1;
  }
  const next = document.createRange();
  if (caretNode.nodeType === Node.TEXT_NODE) {
    next.setStart(caretNode, caretOffset);
  } else {
    next.setStart(caretNode, caretOffset);
  }
  next.collapse(true);
  sel.removeAllRanges();
  sel.addRange(next);
}

/** Insert a serialized template string at the current caret, treating
 *  {{path}} runs as chips. Used by the paste handler. */
function insertSerializedAtCaret(root: HTMLDivElement, text: string): void {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer)) {
    range.selectNodeContents(root);
    range.collapse(false);
  }
  range.deleteContents();

  const frag = document.createDocumentFragment();
  let last = 0;
  VAR_RE.lastIndex = 0;
  for (const m of text.matchAll(VAR_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) appendPlain(frag, text.slice(last, idx));
    frag.appendChild(buildChip(m[1]));
    last = idx + m[0].length;
  }
  if (last < text.length) appendPlain(frag, text.slice(last));

  const lastChild = frag.lastChild;
  range.insertNode(frag);
  if (lastChild) {
    const next = document.createRange();
    next.setStartAfter(lastChild);
    next.collapse(true);
    sel.removeAllRanges();
    sel.addRange(next);
  }
}

function appendPlain(frag: DocumentFragment, text: string): void {
  if (!text) return;
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    if (line) frag.appendChild(document.createTextNode(line));
    if (i < lines.length - 1) frag.appendChild(document.createElement('br'));
  });
}

/** If the caret is positioned immediately after a chip (or after a single
 *  ZWSP/space that follows a chip), return that chip. */
function previousChipAtCaret(range: Range): HTMLElement | null {
  if (!range.collapsed) return null;
  const node = range.startContainer;
  const offset = range.startOffset;

  if (node.nodeType === Node.TEXT_NODE) {
    if (offset !== 0) return null;
    const prev = (node as Text).previousSibling;
    return chipOrNull(prev);
  }
  if (node.nodeType === Node.ELEMENT_NODE) {
    if (offset === 0) return null;
    const prev = node.childNodes[offset - 1];
    return chipOrNull(prev);
  }
  return null;
}

function chipOrNull(n: Node | null): HTMLElement | null {
  if (!n) return null;
  if (n.nodeType !== Node.ELEMENT_NODE) return null;
  const el = n as HTMLElement;
  return el.dataset.varPath ? el : null;
}

export default VarRichField;
