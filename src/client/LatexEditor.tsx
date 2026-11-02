import { useEffect, useRef } from 'react';
import { EditorState, Prec, StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { acceptCompletion, autocompletion, type CompletionContext } from '@codemirror/autocomplete';
import { StreamLanguage, defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { stex } from '@codemirror/legacy-modes/mode/stex';

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
  const match = context.matchBefore(/\\[A-Za-z]*$/);
  if (!match || (match.text === '\\' && !context.explicit)) return null;
  const options = latexCommands.filter(label => label.startsWith(match.text)).map(label => ({ label, type: 'keyword' }));
  return options.length ? { from: match.from, options, validFor: /^\\[A-Za-z]*$/, filter: false } : null;
}

type Props = {
  value: string;
  onChange: (source: string) => void;
  onSave: () => void;
  onCompile: () => void;
  requestCompletion: (prefix: string, suffix: string, signal: AbortSignal) => Promise<string>;
  onCompletionStatus: (status: 'waiting' | 'ready' | 'unavailable') => void;
};

export default function LatexEditor({ value, onChange, onSave, onCompile, requestCompletion, onCompletionStatus }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const callbacks = useRef({ onChange, onSave, onCompile, requestCompletion, onCompletionStatus });
  callbacks.current = { onChange, onSave, onCompile, requestCompletion, onCompletionStatus };

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
          lineNumbers(), highlightActiveLineGutter(), highlightActiveLine(), history(),
          StreamLanguage.define(stex), syntaxHighlighting(defaultHighlightStyle),
          autocompletion({ override: [latexCompletions] }), ghostField,
          EditorView.contentAttributes.of({ 'aria-label': 'LaTeX source editor', spellcheck: 'false' }),
          Prec.high(keymap.of([
            { key: 'Tab', run(view) {
              const ghost = view.state.field(ghostField);
              if (ghost) { view.dispatch({ changes: { from: ghost.pos, insert: ghost.text } }); return true; }
              if (acceptCompletion(view)) return true;
              view.dispatch(view.state.replaceSelection('  ')); return true;
            } },
            { key: 'Escape', run(view) {
              if (!view.state.field(ghostField)) return false;
              view.dispatch({ effects: setGhost.of(null) }); return true;
            } },
            { key: 'Mod-s', run() { callbacks.current.onSave(); return true; } },
            { key: 'Mod-Enter', run() { callbacks.current.onCompile(); return true; } },
          ])),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.updateListener.of(update => {
            if (!update.docChanged && !update.transactions.some(transaction => transaction.selection)) return;
            window.clearTimeout(timer);
            controller?.abort();
            sequence++;
            if (!update.docChanged) return;
            const source = update.state.doc.toString();
            callbacks.current.onChange(source);
            const cursor = update.state.selection.main.head;
            const beforeCursor = source.slice(0, cursor);
            if (Date.now() < retryAfter || cursor < 20 || update.state.doc.lineAt(cursor).to !== cursor ||
              !beforeCursor.includes('\\begin{document}') || beforeCursor.lastIndexOf('\\end{document}') > beforeCursor.lastIndexOf('\\begin{document}')) return;
            const currentSequence = sequence;
            timer = window.setTimeout(async () => {
              const requestController = new AbortController();
              controller = requestController;
              callbacks.current.onCompletionStatus('waiting');
              try {
                const completion = await callbacks.current.requestCompletion(source.slice(Math.max(0, cursor - 3000), cursor), source.slice(cursor, cursor + 1000), requestController.signal);
                const text = completion.split('\n')[0].slice(0, 160);
                if (text && currentSequence === sequence && view.state.doc.toString() === source && view.state.selection.main.head === cursor) {
                  view.dispatch({ effects: setGhost.of({ pos: cursor, text }) });
                  callbacks.current.onCompletionStatus('ready');
                } else if (!text && currentSequence === sequence) {
                  retryAfter = Date.now() + 60000;
                  callbacks.current.onCompletionStatus('unavailable');
                }
              } catch {
                if (!requestController.signal.aborted) {
                  retryAfter = Date.now() + 60000;
                  callbacks.current.onCompletionStatus('unavailable');
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

  return <div className="source-editor" ref={host}/>;
}
