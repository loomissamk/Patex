import { useEffect, useRef } from 'react';
import { EditorState, Prec, StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { acceptCompletion, autocompletion, nextSnippetField, prevSnippetField, snippet, snippetCompletion, type CompletionContext } from '@codemirror/autocomplete';
import { StreamLanguage, defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { stex } from '@codemirror/legacy-modes/mode/stex';
import { r } from '@codemirror/legacy-modes/mode/r';
import { javascript as javascriptLanguage } from '@codemirror/lang-javascript';
import { markdown } from '@codemirror/lang-markdown';
import { python as pythonLanguage } from '@codemirror/lang-python';
import { lintGutter, linter, forceLinting } from '@codemirror/lint';
import type { Diagnostic } from '../shared/types';
import { mathExpressions } from '../shared/math-library';
import { checkMath, insideMath } from '../shared/math-check';
import type { ScriptLanguage } from '../shared/types';

type Ghost = { pos: number; text: string } | null;
const setGhost = StateEffect.define<Ghost>();

class GhostWidget extends WidgetType {
  constructor(readonly text: string) { super(); }
  eq(other: GhostWidget) { return this.text === other.text; }
  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-inline-ghost';
    span.textContent = this.text;
    return span;
  }
}

const ghostField = StateField.define<Ghost>({
  create: () => null,
  update(value, transaction) {
    if (transaction.docChanged || transaction.selection) value = null;
    for (const effect of transaction.effects) if (effect.is(setGhost)) value = effect.value;
    return value;
  },
  provide: field => EditorView.decorations.from(field, value => value
    ? Decoration.set([Decoration.widget({ widget: new GhostWidget(value.text), side: 1 }).range(value.pos)])
    : Decoration.none),
});

const latexCommands = [
  '\\begin{equation}', '\\end{equation}', '\\begin{align}', '\\end{align}',
  '\\frac{}{}', '\\sqrt{}', '\\sum', '\\int', '\\label{}', '\\ref{}',
  '\\cite{}', '\\section{}', '\\subsection{}', '\\textbf{}', '\\emph{}',
  '\\alpha', '\\beta', '\\gamma', '\\theta', '\\pi', '\\infty',
];
function latexCompletions(context: CompletionContext) {
  const match = context.matchBefore(/\\[A-Za-z]*$/) || (insideMath(context.state.doc.toString(), context.pos) ? context.matchBefore(/[a-z]{2,}$/) : null);
  if (!match || (match.text === '\\' && !context.explicit)) return null;
  const query = match.text.replace(/^\\/, '').toLowerCase();
  const snippets = mathExpressions.filter(item => item.id.startsWith(query) || item.aliases.some(alias => alias.startsWith(query))).map(item => snippetCompletion(item.template, { label: `${match.text.startsWith('\\') ? '\\' : ''}${item.id}`, type: 'snippet', detail: item.name }));
  const options = [...snippets, ...latexCommands.filter(label => label.startsWith(match.text)).map(label => ({ label, type: 'keyword' }))];
  return options.length ? { from: match.from, options, validFor: /^\\[A-Za-z]*$/, filter: false } : null;
}

type Props = {
  language: 'latex' | 'rmd' | 'qmd' | 'bibliography' | ScriptLanguage;
  value: string;
  onChange: (source: string) => void;
  onSave: () => void;
  onExecute: () => void;
  requestCompletion?: (prefix: string, suffix: string, signal: AbortSignal) => Promise<string>;
  onCompletionStatus?: (status: 'waiting' | 'ready' | 'unavailable') => void;
  citationKeys?: string[];
  labels?: string[];
  diagnostics?: Diagnostic[];
  jumpTo?: { line: number; nonce: number };
  onCursor?: (selection: { from: number; to: number; line: number }) => void;
  insertSnippet?: { template: string; block: boolean; nonce: number };
  onInserted?: () => void;
};

export default function SourceEditor({ language, value, onChange, onSave, onExecute, requestCompletion, onCompletionStatus, citationKeys = [], labels = [], diagnostics = [], jumpTo, onCursor, insertSnippet, onInserted }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const callbacks = useRef({ onChange, onSave, onExecute, requestCompletion, onCompletionStatus, citationKeys, labels, onCursor, diagnostics });
  callbacks.current = { onChange, onSave, onExecute, requestCompletion, onCompletionStatus, citationKeys, labels, onCursor, diagnostics };

  useEffect(() => {
    if (!host.current) return;
    let timer: number | undefined;
    let controller: AbortController | undefined;
    let sequence = 0;
    let retryAfter = 0;
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(), highlightActiveLineGutter(), highlightActiveLine(), history(), lintGutter(),
          linter(view => {
            const local = ['latex', 'rmd', 'qmd'].includes(language) ? checkMath(view.state.doc.toString()).map(issue => ({ from: issue.from, to: issue.to, severity: 'warning' as const, message: issue.message, ...(issue.replacement ? { actions: [{ name: 'Fix command', apply: (editor: EditorView, from: number, to: number) => editor.dispatch({ changes: { from, to, insert: issue.replacement! } }) }] } : {}) })) : [];
            return [...local, ...callbacks.current.diagnostics.filter(item => item.line && item.line <= view.state.doc.lines).map(item => { const line = view.state.doc.line(Math.max(1, item.line!)); return { from: line.from, to: line.to, severity: item.severity, message: item.message }; })];
          }, { delay: 350 }),
          language === 'latex' || language === 'bibliography' ? StreamLanguage.define(stex) : language === 'rmd' || language === 'qmd' ? markdown() : language === 'javascript' ? javascriptLanguage() : language === 'python' ? pythonLanguage() : StreamLanguage.define(r),
          syntaxHighlighting(defaultHighlightStyle),
          ['latex', 'rmd', 'qmd'].includes(language) ? autocompletion({ override: [context => {
            const cite = context.matchBefore(/\\(?:cite\w*|autocite|parencite)(?:\[[^\]]*\])*\{[^}]*$/);
            const reference = context.matchBefore(/\\(?:eqref|ref|autoref|cref)\{[^}]*$/);
            const at = context.matchBefore(/@[\w:./-]*$/);
            const match = cite || reference;
            if (match) { const offset = Math.max(match.text.lastIndexOf('{'), match.text.lastIndexOf(',')) + 1; return { from: match.from + offset, options: (reference ? callbacks.current.labels : callbacks.current.citationKeys).map(label => ({ label, type: 'reference' })) }; }
            if (at) return { from: at.from + 1, options: [...callbacks.current.citationKeys, ...callbacks.current.labels].map(label => ({ label, type: 'reference' })) };
            return null;
          }, latexCompletions] }) : autocompletion(), ghostField,
          EditorView.contentAttributes.of({ 'aria-label': language === 'latex' ? 'LaTeX source editor' : language === 'bibliography' ? 'BibTeX bibliography editor' : language === 'rmd' || language === 'qmd' ? 'Document source editor' : `${language} source editor`, spellcheck: 'false' }),
          Prec.high(keymap.of([
            { key: 'Tab', run(view) {
              const ghost = view.state.field(ghostField);
              if (ghost) { view.dispatch({ changes: { from: ghost.pos, insert: ghost.text } }); return true; }
              if (nextSnippetField(view)) return true;
              if (acceptCompletion(view)) return true;
              view.dispatch(view.state.replaceSelection('  ')); return true;
            } },
            { key: 'Shift-Tab', run: prevSnippetField },
            { key: 'Escape', run(view) {
              if (!view.state.field(ghostField)) return false;
              view.dispatch({ effects: setGhost.of(null) }); return true;
            } },
            { key: 'Mod-s', run() { callbacks.current.onSave(); return true; } },
            { key: 'Mod-Enter', run() { callbacks.current.onExecute(); return true; } },
          ])),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.updateListener.of(update => {
            if (!update.docChanged && !update.transactions.some(transaction => transaction.selection)) return;
            window.clearTimeout(timer);
            controller?.abort();
            sequence++;
            const selection = update.state.selection.main;
            callbacks.current.onCursor?.({ from: selection.from, to: selection.to, line: update.state.doc.lineAt(selection.head).number });
            if (!update.docChanged) return;
            const source = update.state.doc.toString();
            callbacks.current.onChange(source);
            if (!['latex', 'rmd', 'qmd'].includes(language) || !callbacks.current.requestCompletion) return;
            const cursor = update.state.selection.main.head;
            const beforeCursor = source.slice(0, cursor);
            if (Date.now() < retryAfter || cursor < 20 || update.state.doc.lineAt(cursor).to !== cursor) return;
            if (language === 'latex' && (!beforeCursor.includes('\\begin{document}') || beforeCursor.lastIndexOf('\\end{document}') > beforeCursor.lastIndexOf('\\begin{document}'))) return;
            const currentSequence = sequence;
            timer = window.setTimeout(async () => {
              const requestController = new AbortController();
              controller = requestController;
              callbacks.current.onCompletionStatus?.('waiting');
              try {
                const completion = await callbacks.current.requestCompletion!(source.slice(Math.max(0, cursor - 3000), cursor), source.slice(cursor, cursor + 1000), requestController.signal);
                const text = completion.split('\n')[0].slice(0, 160);
                if (text && callbacks.current.requestCompletion && currentSequence === sequence && view.state.doc.toString() === source && view.state.selection.main.head === cursor) {
                  view.dispatch({ effects: setGhost.of({ pos: cursor, text }) });
                  callbacks.current.onCompletionStatus?.('ready');
                } else if (!text && currentSequence === sequence) {
                  retryAfter = Date.now() + 15000;
                  callbacks.current.onCompletionStatus?.('unavailable');
                }
              } catch {
                if (!requestController.signal.aborted) {
                  retryAfter = Date.now() + 15000;
                  callbacks.current.onCompletionStatus?.('unavailable');
                }
              }
            }, 1200);
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      window.clearTimeout(timer);
      controller?.abort();
      sequence++;
      view.destroy();
      viewRef.current = null;
    };
    // A project change remounts this component by key, preserving its own editor state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (view && view.state.doc.toString() !== value) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
  }, [value]);
  useEffect(() => {
    const view = viewRef.current; if (!view || !jumpTo) return;
    const line = view.state.doc.line(Math.max(1, Math.min(view.state.doc.lines, jumpTo.line)));
    view.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: 'center' }) }); view.focus();
  }, [jumpTo]);
  useEffect(() => {
    const view = viewRef.current; if (view) forceLinting(view);
  }, [diagnostics]);
  useEffect(() => {
    const view = viewRef.current; if (!view || !insertSnippet) return;
    const selection = view.state.selection.main;
    let template = insertSnippet.template;
    if (!insideMath(view.state.doc.toString(), selection.from)) template = insertSnippet.block ? language === 'latex' ? `\\[\n${template}\n\\]` : `$$\n${template}\n$$` : `$${template}$`;
    snippet(template)(view, { label: 'Math expression' }, selection.from, selection.to); view.focus(); onInserted?.();
  }, [insertSnippet, language, onInserted]);

  return <div className="source-editor" ref={host}/>;
}
