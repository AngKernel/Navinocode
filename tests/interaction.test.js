import test from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_RESULTS, isComposingEvent, parseTimerMinutes } from '../src/advanced/interactionUtils.js';

 test('default result array has stable identity across render-like calls', () => {
  const readDefault = ({ extraResults = EMPTY_RESULTS }) => extraResults;
  assert.equal(readDefault({}), readDefault({}));
  assert.equal(Object.isFrozen(EMPTY_RESULTS), true);
});

 test('composition key events are not command confirmations', () => {
  assert.equal(isComposingEvent({ isComposing: true }), true);
  assert.equal(isComposingEvent({ nativeEvent: { isComposing: true } }), true);
  assert.equal(isComposingEvent({ keyCode: 229 }), true);
  assert.equal(isComposingEvent({ nativeEvent: { keyCode: 229 } }), true);
});

 test('normal Enter and arrow events remain available to the command center', () => {
  assert.equal(isComposingEvent({ key: 'Enter', nativeEvent: { isComposing: false } }), false);
  assert.equal(isComposingEvent({ key: 'ArrowDown' }), false);
});

 test('timer supports integer minutes within 1 through 180', () => {
  for (const [input, expected] of [['1', 1], ['180', 180], [' 45 ', 45], [25, 25]]) {
    assert.equal(parseTimerMinutes(input), expected);
  }
});

 test('timer rejects suffixes, fractions, exponents and out-of-range values', () => {
  for (const input of ['45abc', '25.5', '1e2', '', '0', '181', '-5', null, undefined, Infinity]) {
    assert.equal(parseTimerMinutes(input), null, String(input));
  }
});
