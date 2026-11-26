// Immutable, local-only edit history. This stores recipes, never audio.
const CAP = 10000;
function frame(n) { if (!Number.isSafeInteger(n) || n < 0) throw new RangeError('frame'); return n; }
function validate(h) {
  if (!h || h.schemaVersion !== 1 || !Object.isFrozen(h) ||
      !Object.isFrozen(h.operations) || !Object.isFrozen(h.trackIds) ||
      !Array.isArray(h.operations) || h.operations.length > CAP ||
      !Number.isSafeInteger(h.cursor) || h.cursor < 0 || h.cursor > h.operations.length ||
      !Array.isArray(h.trackIds) || h.trackIds.length < 1 || h.trackIds.length > 10 ||
      new Set(h.trackIds).size !== h.trackIds.length ||
      !Number.isSafeInteger(h.durationFrames) || h.durationFrames < 1 ||
      h.operations.some(op => !Object.isFrozen(op))) throw new TypeError('history');
}
export function createOperationHistory({trackIds, durationFrames}) {
  if (!Array.isArray(trackIds) || trackIds.length < 1 || trackIds.length > 10 ||
      trackIds.some(id => typeof id !== 'string' || !id || id.length > 128) ||
      new Set(trackIds).size !== trackIds.length) throw new RangeError('trackIds');
  frame(durationFrames);
  if (!durationFrames) throw new RangeError('durationFrames');
  return Object.freeze({schemaVersion:1, trackIds:Object.freeze([...trackIds]),
    durationFrames, operations:Object.freeze([]), cursor:0});
}
export function appendOperation(history, operation) {
  validate(history);
  if (history.cursor >= CAP) throw new RangeError('operation cap');
  if (!operation || typeof operation !== 'object' || Array.isArray(operation) ||
      !['gain','mute'].includes(operation.type) ||
      !history.trackIds.includes(operation.trackId)) throw new RangeError('operation');
  const startFrame=frame(operation.startFrame), endFrame=frame(operation.endFrame);
  if (endFrame <= startFrame || endFrame > history.durationFrames) throw new RangeError('interval');
  if (operation.type === 'mute' && Object.hasOwn(operation,'gain')) throw new RangeError('mute gain');
  const gain=operation.type === 'mute' ? 0 : operation.gain;
  if (!Number.isFinite(gain) || gain < 0 || gain > 4) throw new RangeError('gain');
  const entry=Object.freeze({type:operation.type,trackId:operation.trackId,startFrame,endFrame,gain});
  const operations=Object.freeze([...history.operations.slice(0,history.cursor),entry]);
  return Object.freeze({...history,operations,cursor:operations.length});
}
export function moveHistoryCursor(history,cursor) {
  validate(history);
  if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > history.operations.length) throw new RangeError('cursor');
  return Object.freeze({...history,cursor});
}
export function activeOperations(history) {
  validate(history);
  return Object.freeze(history.operations.slice(0,history.cursor));
}
