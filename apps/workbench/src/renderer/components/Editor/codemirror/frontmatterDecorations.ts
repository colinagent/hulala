import { StateEffect, StateField, type EditorState, type Extension, type Range } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import { getFrontmatterInfo } from './utils/frontmatter';
import { shouldCollapseFrontmatterYaml, toggleFrontmatterSourceModeEffect } from '../../../utils/frontmatterPanelState';
import { buildThreadLinkTarget } from '../../../utils/threadLink';
import {
  parseFrontmatterStringValue,
  parseThreadFrontmatterValue,
} from '../../../utils/frontmatterParser';
import { isSelectionOverlappingRange } from './utils/selectionOverlap';

function isCursorOnLineOverlappingRange(state: EditorState, range: { from: number; to: number }): boolean {
  const cursorLine = state.doc.lineAt(state.selection.main.head);
  return cursorLine.from <= range.to && cursorLine.to >= range.from;
}

class FrontmatterReferenceWidget extends WidgetType {
  constructor(
    private readonly label: string,
    private readonly target: string,
    private readonly rawValue: string,
  ) {
    super();
  }

  eq(other: FrontmatterReferenceWidget): boolean {
    return this.label === other.label && this.target === other.target && this.rawValue === other.rawValue;
  }

  toDOM(): HTMLElement {
    const element = document.createElement('span');
    element.className = 'cm-md-frontmatter-link';
    element.dataset.mdLink = this.target;
    element.dataset.mdFrontmatterRaw = this.rawValue;
    element.textContent = this.label;
    return element;
  }
}

type ParsedFrontmatterLinkLine = {
  kind: 'thread';
  valueText: string;
  target: string;
  replacementLabel?: string | null;
};

export function parseFrontmatterLinkLine(
  lineText: string,
): ParsedFrontmatterLinkLine | null {
  const match = lineText.match(/^([a-zA-Z0-9_-]+):\s*(.+)$/);
  if (!match) {
    return null;
  }
  const key = match[1].trim().toLowerCase();
  const valueText = match[2].trim();
  if (!valueText) {
    return null;
  }
  if (key !== 'thread' && key !== 'parent_thread') {
    return null;
  }
  const threadID = parseThreadFrontmatterValue(parseFrontmatterStringValue(valueText));
  const target = buildThreadLinkTarget(threadID);
  if (!target) {
    return null;
  }
  return {
    kind: 'thread',
    valueText,
    target,
  };
}

const refreshFrontmatterDecorationsEffect = StateEffect.define<null>();

function buildFrontmatterDecorationSet(state: EditorState): DecorationSet {
  const fm = getFrontmatterInfo(state);
  if (!fm) {
    return Decoration.none;
  }

  const decorations: Array<Range<Decoration>> = [];
  const cursorInBlock = isCursorOnLineOverlappingRange(state, { from: fm.from, to: fm.to });
  const collapseYaml = shouldCollapseFrontmatterYaml(state);

  for (let lineNumber = 1; lineNumber <= fm.endLineNumber; lineNumber += 1) {
    const line = state.doc.line(lineNumber);
    const classes = ['cm-md-frontmatter-line'];
    if (collapseYaml) {
      classes.push('cm-md-frontmatter-collapsed');
    }
    const isStart = lineNumber === 1;
    const isEnd = lineNumber === fm.endLineNumber;
    if (isStart) classes.push('cm-md-frontmatter-start');
    if (isEnd) classes.push('cm-md-frontmatter-end');
    if (isStart || isEnd) {
      classes.push('cm-md-frontmatter-delim');
      if (!cursorInBlock) classes.push('cm-md-frontmatter-delim-hidden');
    }
    decorations.push(Decoration.line({ class: classes.join(' ') }).range(line.from));

    const frontmatterLink = parseFrontmatterLinkLine(line.text);
    if (frontmatterLink && !collapseYaml) {
      const valueStart = line.text.lastIndexOf(frontmatterLink.valueText);
      if (valueStart >= 0) {
        const rangeFrom = line.from + valueStart;
        const rangeTo = rangeFrom + frontmatterLink.valueText.length;
        const valueInSourceMode = isSelectionOverlappingRange(state.selection.main, rangeFrom, rangeTo);
        if (!valueInSourceMode && frontmatterLink.replacementLabel) {
          decorations.push(
            Decoration.replace({
              widget: new FrontmatterReferenceWidget(
                frontmatterLink.replacementLabel,
                frontmatterLink.target,
                frontmatterLink.valueText,
              ),
            }).range(rangeFrom, rangeTo)
          );
        } else {
          decorations.push(
            Decoration.mark({
              class: 'cm-md-frontmatter-link',
              attributes: {
                'data-md-link': frontmatterLink.target,
              },
            }).range(rangeFrom, rangeTo)
          );
        }
      }
    }
  }

  if (collapseYaml) {
    for (let lineNumber = fm.endLineNumber + 1; lineNumber <= state.doc.lines; lineNumber += 1) {
      const line = state.doc.line(lineNumber);
      if (line.text.trim()) {
        break;
      }
      if (isCursorOnLineOverlappingRange(state, { from: line.from, to: line.to })) {
        continue;
      }
      decorations.push(
        Decoration.line({ class: 'cm-md-frontmatter-collapsed' }).range(line.from),
      );
    }
  }

  return Decoration.set(decorations, true);
}

const frontmatterDecorationsField = StateField.define<DecorationSet>({
  create: buildFrontmatterDecorationSet,
  update: (value, tr) => {
    if (
      !tr.docChanged
      && !tr.selection
      && !tr.effects.some((effect) => effect.is(refreshFrontmatterDecorationsEffect))
      && !tr.effects.some((effect) => effect.is(toggleFrontmatterSourceModeEffect))
    ) {
      return value;
    }
    return buildFrontmatterDecorationSet(tr.state);
  },
  provide: (field) => EditorView.decorations.from(field),
});

export function frontmatterDecorations(): Extension {
  return [
    frontmatterDecorationsField,
  ];
}
