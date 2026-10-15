import { WidgetType } from '@codemirror/view';
import { CM_MD_INLINE_PILL } from '../markdownInlinePill';
import {
  buildPromptVariableTooltip,
  isKnownPromptVariableName,
  type PromptVariableName,
} from '../../../../utils/promptVariables';

type PromptVariableWidgetOptions = {
  name: string;
  raw: string;
  resolvedValues: Record<PromptVariableName, string>;
};

export class PromptVariableWidget extends WidgetType {
  private readonly name: string;
  private readonly raw: string;
  private readonly resolvedValues: Record<PromptVariableName, string>;

  constructor(options: PromptVariableWidgetOptions) {
    super();
    this.name = options.name;
    this.raw = options.raw;
    this.resolvedValues = options.resolvedValues;
  }

  eq(other: PromptVariableWidget): boolean {
    return (
      other.name === this.name
      && other.raw === this.raw
      && other.resolvedValues.platform === this.resolvedValues.platform
      && other.resolvedValues.agentRoot === this.resolvedValues.agentRoot
      && other.resolvedValues.agentHome === this.resolvedValues.agentHome
    );
  }

  toDOM(): HTMLElement {
    const element = document.createElement('span');
    const known = isKnownPromptVariableName(this.name);
    element.className = known
      ? `${CM_MD_INLINE_PILL} cm-md-prompt-variable`
      : `${CM_MD_INLINE_PILL} cm-md-prompt-variable cm-md-prompt-variable-unknown`;
    element.dataset.promptVariable = this.name;
    element.textContent = this.raw;
    element.title = buildPromptVariableTooltip(this.name, this.resolvedValues);
    return element;
  }

  ignoreEvent(): boolean {
    return false;
  }
}
