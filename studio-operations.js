// Immutable, local-only edit history. This stores recipes, never audio.
const CAP = 10000;
function frame(n) { if (!Number.isSafeInteger(n) || n < 0) throw new RangeError('frame'); return n; }
// Frozen objects are not a provenance boundary. Treat external or restored
// histories as untrusted recipes and validate every entry before exposing it.
function ownData(obj, key) {
  const descriptor = Object.getOwnPropertyDescriptor(obj, key);
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new TypeError('history');
  return descriptor.value;
}
const OP_KEYS = Object.freeze(['type','trackId','startFrame','endFrame','gain']);
function validate(h) {
  if (!h || typeof h !== 'object' || Array.isArray(h) || !Object.isFrozen(h))
    throw new TypeError('history');
  const schemaVersion = ownData(h, 'schemaVersion');
  const trackIds = ownData(h, 'trackIds');
  const durationFrames = ownData(h, 'durationFrames');
  const operations = ownData(h, 'operations');
  const cursor = ownData(h, 'cursor');
  if (schemaVersion !== 1 ||
      !Number.isSafeInteger(durationFrames) || durationFrames < 1 ||
      !Array.isArray(trackIds) || !Object.isFrozen(trackIds) ||
      trackIds.length < 1 || trackIds.length > 10 ||
      !Array.isArray(operations) || !Object.isFrozen(operations) ||
      operations.length > CAP || !Number.isSafeInteger(cursor) ||
      cursor < 0 || cursor > operations.length) throw new TypeError('history');
  const allowed = new Set();
  for (let i = 0; i < trackIds.length; i++) {
    if (!Object.hasOwn(trackIds, i)) throw new TypeError('history');
    const id = ownData(trackIds, String(i));
    if (typeof id !== 'string' || !id || id.length > 128 || allowed.has(id))
      throw new TypeError('history');
    allowed.add(id);
  }
  for (let i = 0; i < operations.length; i++) {
    if (!Object.hasOwn(operations, i)) throw new TypeError('history');
    const op = ownData(operations, String(i));
    if (!op || typeof op !== 'object' || Array.isArray(op) ||
        !Object.isFrozen(op) || Reflect.ownKeys(op).length !== OP_KEYS.length)
      throw new TypeError('history');
    const type = ownData(op, 'type');
    const trackId = ownData(op, 'trackId');
    const startFrame = ownData(op, 'startFrame');
    const endFrame = ownData(op, 'endFrame');
    const gain = ownData(op, 'gain');
    if ((type !== 'gain' && type !== 'mute') || !allowed.has(trackId) ||
        !Number.isSafeInteger(startFrame) || startFrame < 0 ||
        !Number.isSafeInteger(endFrame) || endFrame <= startFrame ||
        endFrame > durationFrames || !Number.isFinite(gain) ||
        gain < 0 || gain > 4 || (type === 'mute' && gain !== 0))
      throw new TypeError('history');
  }
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
