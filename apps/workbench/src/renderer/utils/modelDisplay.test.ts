import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildModelSelectOption,
  getDisplayModelKeyText,
  getModelDisplayInfo,
  getVisibleProviderLabel,
} from './modelDisplay';

test('getModelDisplayInfo uses model name as primary text and model id as secondary text', () => {
  assert.deepEqual(getModelDisplayInfo('example-model', 'claude-opus-4-6', 'Local Anthropic'), {
    primaryText: 'claude-opus-4-6',
    secondaryText: 'example-model',
    providerText: 'Local Anthropic',
    triggerText: 'claude-opus-4-6',
    titleText: 'claude-opus-4-6 · example-model · Local Anthropic',
  });
});

test('getModelDisplayInfo hides duplicate model id text', () => {
  assert.deepEqual(getModelDisplayInfo('claude-opus-4-6', 'claude-opus-4-6', 'Hulala'), {
    primaryText: 'claude-opus-4-6',
    secondaryText: null,
    providerText: 'Hulala',
    triggerText: 'claude-opus-4-6',
    titleText: 'claude-opus-4-6 · Hulala',
  });
});

test('getModelDisplayInfo hides missing model name text', () => {
  assert.deepEqual(getModelDisplayInfo('gpt-5.4', '', 'Hulala'), {
    primaryText: 'gpt-5.4',
    secondaryText: null,
    providerText: 'Hulala',
    triggerText: 'gpt-5.4',
    titleText: 'gpt-5.4 · Hulala',
  });
});

test('buildModelSelectOption uses model name for the label and provider for description', () => {
  assert.deepEqual(
    buildModelSelectOption({
      key: 'local-openai:example-model',
      id: 'example-model',
      label: 'claude-opus-4-6',
      provider: 'local-openai',
      providerLabel: 'Local OpenAI',
    }),
    {
      value: 'local-openai:example-model',
      label: 'claude-opus-4-6',
      description: 'example-model · Local OpenAI',
      title: 'claude-opus-4-6 · example-model · Local OpenAI',
    },
  );
});

test('getDisplayModelKeyText shows the provider prefix for Hulala models', () => {
  assert.equal(getDisplayModelKeyText('hulala:gpt-5.4', 'Hulala'), 'hulala:gpt-5.4');
});

test('getVisibleProviderLabel shows the Hulala provider label', () => {
  assert.equal(getVisibleProviderLabel('hulala', 'Hulala'), 'Hulala');
});

test('getVisibleProviderLabel preserves an explicitly configured provider label', () => {
  assert.equal(getVisibleProviderLabel('hulala', 'Custom'), 'Custom');
});

test('getDisplayModelKeyText keeps the real provider key even when the label differs', () => {
  assert.equal(getDisplayModelKeyText('codemirror-gpt5.4:gpt-5.4', 'codemirror'), 'codemirror-gpt5.4:gpt-5.4');
});

test('getDisplayModelKeyText uses the provider key for custom models', () => {
  assert.equal(getDisplayModelKeyText('acme:gpt-5.4', 'Acme'), 'acme:gpt-5.4');
});
