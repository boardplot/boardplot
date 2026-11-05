/**
 * The option builders of the generated-column contract, one per key. A chart
 * type adds a key to its own schema from here, in the same change as its reader.
 * Each description prints the type's ids, so its reference page lists them.
 */
import * as z from 'zod';
import { generatedIdList, type GeneratedColumnType, type GeneratedIdKey } from './generatedColumns';
import { idRecord } from './shared';

const id = (what: string) => z.string().min(1).describe(what);
const idsOf = (type: GeneratedColumnType, key: GeneratedIdKey) => ` Ids: ${generatedIdList(type, key)}.`;
const alignment = z.enum(['left', 'right', 'center']);

const overrideFields = {
  width: z.number().positive().optional().describe('Track width in px. It beats the width the type would pick.'),
  align: alignment.optional().describe('Alignment of the column: its cell text and, unless headAlign is set, its head. Bars keep starting at the panel origin.'),
  headAlign: alignment.optional().describe('Head alignment; defaults to align.'),
  label: z.string().optional().describe('Head text.'),
};

export type ColumnOverrideField = keyof typeof overrideFields;

/** `table` reads data.columnToggles ids. Every other type passes its own ids. */
export function columnVisibilityOption(type: GeneratedColumnType | 'table') {
  return idRecord(id('Column id, or a data.columnToggles id on table.'), z.boolean().describe('True shows the column; false leaves it out.')).optional()
    .describe(`True shows a column and false leaves it out: the ids are data.columnToggles ids on table and column ids elsewhere.${type === 'table' ? '' : idsOf(type, 'columnVisibility')}`);
}

/** `fields` names the settings this type reads. */
export function columnOverridesOption(type: GeneratedColumnType, fields: readonly ColumnOverrideField[]) {
  const shape = Object.fromEntries(fields.map((field) => [field, overrideFields[field]]));
  return idRecord(id('Column id.'), z.strictObject(shape).describe('Settings of one column.')).optional()
    .describe(`Settings per generated column.${idsOf(type, 'columnOverrides')}`);
}

export function columnOrderOption(type: GeneratedColumnType) {
  return z.array(id('Block id.')).optional()
    .describe(`Order of whole blocks; blocks left out follow in default order.${idsOf(type, 'columnOrder')}`);
}

export function rowVisibilityOption(type: GeneratedColumnType) {
  return idRecord(id('Row id.'), z.boolean().describe('False leaves the row out.')).optional()
    .describe(`False leaves a generated row out.${idsOf(type, 'rowVisibility')}`);
}

export function rowOrderOption(type: GeneratedColumnType) {
  return z.array(id('Row id.')).optional()
    .describe(`Order of the generated rows; rows left out follow in default order.${idsOf(type, 'rowOrder')}`);
}

export function rowOverridesOption(type: GeneratedColumnType) {
  return idRecord(id('Row id.'), z.strictObject({ label: z.string().optional().describe('Row name.') }).describe('Settings of one row.')).optional()
    .describe(`Settings per generated row.${idsOf(type, 'rowOverrides')}`);
}

/** No type's ids apply here: the key names no column. */
export function columnHeadsOption() {
  return z.literal(false).optional()
    .describe('false: no visible head row and no group heads, with their height and rule. Assistive technology still reads the head in React, and sortable warns there.');
}
