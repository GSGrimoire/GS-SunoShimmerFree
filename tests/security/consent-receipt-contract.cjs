'use strict';
// Synthetic contract prototype only. NOT connected to product consent, persistence or uploads.
const GROUPS = Object.freeze(['processing_decisions','perceptual_preferences','audio_examples','artifact_annotations','reference_examples']);
const TYPES = Object.freeze({
  processing_decisions:['manual_edits','model_errors'],
  perceptual_preferences:['ratings','rankings','mix_preferences'],
  audio_examples:['original_excerpts','processed_excerpts'],
  artifact_annotations:['restoration_labels'],
  reference_examples:['reference_excerpts']
});
const EXACT = (obj, keys) => obj && typeof obj === 'object' && !Array.isArray(obj) &&
  Object.keys(obj).sort().join('|') === [...keys].sort().join('|');
const iso = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && !Number.isNaN(Date.parse(value));
const token = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{8,128}$/.test(value);
function validateReceipt(r) {
  if (!EXACT(r,['schemaVersion','consentVersion','subjectPseudonym','recordedAt','purpose','processing','training','rightsAttested','revokedAt'])) return false;
  if (r.schemaVersion !== 1 || !token(r.consentVersion) || !token(r.subjectPseudonym) || !iso(r.recordedAt) || r.purpose !== 'local_studio' || typeof r.rightsAttested !== 'boolean') return false;
  if (!EXACT(r.processing,['externalTransferAllowed','processorId']) || typeof r.processing.externalTransferAllowed !== 'boolean') return false;
  if (r.processing.externalTransferAllowed ? !token(r.processing.processorId) : r.processing.processorId !== null) return false;
  if (!EXACT(r.training,GROUPS)) return false;
  for (const group of GROUPS) {
    const entry = r.training[group];
    if (!EXACT(entry,['enabled','types']) || typeof entry.enabled !== 'boolean' || !EXACT(entry.types,TYPES[group])) return false;
    if (Object.values(entry.types).some(v => typeof v !== 'boolean')) return false;
    if (!entry.enabled && Object.values(entry.types).some(Boolean)) return false;
    if (entry.enabled && (!r.rightsAttested || !Object.values(entry.types).some(Boolean))) return false;
  }
  if (r.revokedAt !== null) {
    if (!iso(r.revokedAt) || Date.parse(r.revokedAt) < Date.parse(r.recordedAt)) return false;
    if (r.processing.externalTransferAllowed || GROUPS.some(g=>r.training[g].enabled)) return false;
  }
  return true;
}
module.exports={validateReceipt,GROUPS,TYPES};
