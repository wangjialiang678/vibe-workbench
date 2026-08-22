import markdown from './markdown.mjs';
import diagram from './diagram.mjs';
import choice from './choice.mjs';
import verdict from './verdict.mjs';
import freetext from './freetext.mjs';
import editable from './editable.mjs';
import table from './table.mjs';
import code from './code.mjs';
import embed from './embed.mjs';
import prototype from './prototype.mjs';
import checklist from './checklist.mjs';

const registry = new Map();
export const BLOCK_TYPES = [];

export function registerBlockType(definition) {
  if (!definition || typeof definition.type !== 'string' || !definition.type) {
    throw new Error('block type definition requires type');
  }
  if (registry.has(definition.type)) throw new Error(`block type already registered: ${definition.type}`);
  registry.set(definition.type, definition);
  BLOCK_TYPES.push(definition.type);
  return definition;
}

export function unregisterBlockType(type) {
  const definition = registry.get(type);
  if (!definition) return false;
  registry.delete(type);
  BLOCK_TYPES.splice(BLOCK_TYPES.indexOf(type), 1);
  return true;
}

export function getBlockType(type) {
  return registry.get(type);
}

[
  markdown, diagram, choice, verdict, freetext, editable, table, code, embed, prototype, checklist,
].forEach(registerBlockType);
