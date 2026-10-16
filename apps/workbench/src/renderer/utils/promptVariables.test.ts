import assert from 'node:assert/strict';
import test from 'node:test';

import {
  agentHomeFromDefinitionPath,
  agentRootFromDefinitionPath,
  buildPromptVariableTooltip,
  parsePromptVariablesInText,
  resolvePromptVariableValues,
  resolveRuntimePlatform,
} from './promptVariables';

test('parsePromptVariablesInText finds runtime prompt variables', () => {
  assert.deepEqual(parsePromptVariablesInText('on ${platform} at ${agentRoot}'), [
    { name: 'platform', raw: '${platform}', from: 3, to: 14 },
    { name: 'agentRoot', raw: '${agentRoot}', from: 18, to: 30 },
  ]);
});

test('resolveRuntimePlatform maps electron win32 to windows', () => {
  assert.equal(resolveRuntimePlatform('win32'), 'linux');
  assert.equal(resolveRuntimePlatform('windows'), 'windows');
  assert.equal(resolveRuntimePlatform('darwin'), 'darwin');
});

test('agent paths resolve from AGENT.md location', () => {
  const definitionPath = '/tmp/workspace/agents/coder/.agent/AGENT.md';
  assert.equal(agentRootFromDefinitionPath(definitionPath), '/tmp/workspace/agents/coder');
  assert.equal(agentHomeFromDefinitionPath(definitionPath), '/tmp/workspace/agents/coder/.agent');
});

test('agent paths resolve for nested subagents', () => {
  const definitionPath = '/workspace/.agent/subagents/helper/.agent/AGENT.md';
  assert.equal(agentRootFromDefinitionPath(definitionPath), '/workspace/.agent/subagents/helper');
  assert.equal(agentHomeFromDefinitionPath(definitionPath), '/workspace/.agent/subagents/helper/.agent');
});

test('resolvePromptVariableValues bundles runtime values', () => {
  const values = resolvePromptVariableValues(
    '/tmp/workspace/agents/coder/.agent/AGENT.md',
    'darwin',
  );
  assert.equal(values.platform, 'darwin');
  assert.equal(values.agentRoot, '/tmp/workspace/agents/coder');
  assert.equal(values.agentHome, '/tmp/workspace/agents/coder/.agent');
});

test('buildPromptVariableTooltip includes resolved value', () => {
  const tooltip = buildPromptVariableTooltip('platform', {
    platform: 'darwin',
    agentRoot: '/tmp/coder',
    agentHome: '/tmp/coder/.agent',
  });
  assert.match(tooltip, /Runtime prompt variable/);
  assert.match(tooltip, /Expands to: darwin/);
});
