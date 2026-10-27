/** `describe`: the authoring contract for one chart type, or the theme contract. */
import '../core/charts';
import { getChartDefinition, listCharts } from '../core/registry';
import { describeField, describeSchema, describeTheme, describeType, matchingFieldPaths, topLevelFields } from '../core/discovery';
import { unsupportedSuggestion } from '../core/doc/chartValidation';
import { designCardTypes } from '../core/catalog';
import { InputError, ok, type VerbResult } from './result';

interface DescribeInput {
  type?: unknown;
  detail?: unknown;
  /** One field and everything below it, such as valueAxis.break or data.series[].values. */
  path?: unknown;
  /** The JSON Schema of the type's data or options. */
  schema?: unknown;
}

/** The values `describe` takes: every chart type plus `theme`. */
function describeTypes(): string[] {
  return [...listCharts().map((chart) => chart.type).sort(), 'theme'];
}

export function unknownType(type: string, path = '/type'): InputError {
  return new InputError('unknown-type', `unknown chart type '${type}'`, {
    path,
    expected: { values: describeTypes().filter((value) => value !== 'theme') },
    suggest: unsupportedSuggestion(type) ?? 'Call boardplot_list for the types Boardplot draws.',
  });
}

export function describe(input: DescribeInput): VerbResult {
  const detail = input.detail ?? 'compact';
  if (detail !== 'compact' && detail !== 'full') {
    throw new InputError('invalid-argument', 'detail must be compact or full', {
      path: '/detail', expected: { values: ['compact', 'full'] }, suggest: 'Omit detail, or pass full.',
      fix: [{ op: 'replace', path: '/detail', value: 'compact' }],
    });
  }
  if (typeof input.type !== 'string' || input.type === '') {
    throw new InputError('missing-type', 'describe needs a chart type or theme', {
      path: '/type', expected: { values: describeTypes() }, suggest: 'Pass a type from boardplot_list, or theme.',
    });
  }
  const narrowed = input.path !== undefined ? '/path' : input.schema !== undefined ? '/schema' : undefined;
  if (input.type === 'theme') {
    if (narrowed) {
      throw new InputError('invalid-argument', 'path and schema describe a chart type; describe theme lists every token', {
        path: narrowed, suggest: 'Describe theme without path or schema.', fix: [{ op: 'remove', path: narrowed }],
      });
    }
    return ok(describeTheme(detail));
  }
  if (!getChartDefinition(input.type)) throw unknownType(input.type);
  if (input.path !== undefined && input.schema !== undefined) {
    throw new InputError('invalid-argument', 'pass path or schema, not both', {
      path: '/schema', suggest: 'Ask for one field with path, or for the whole schema with schema.', fix: [{ op: 'remove', path: '/schema' }],
    });
  }
  if (input.schema !== undefined) {
    if (input.schema !== 'data' && input.schema !== 'options') {
      throw new InputError('invalid-argument', 'schema must be data or options', {
        path: '/schema', expected: { values: ['data', 'options'] }, suggest: 'Pass schema data or options.',
      });
    }
    return ok(describeSchema(input.type, input.schema));
  }
  if (input.path !== undefined) {
    if (typeof input.path !== 'string' || input.path.trim() === '') {
      throw new InputError('invalid-argument', 'path must be a field path such as valueAxis.break', { path: '/path', expected: { types: ['string'] } });
    }
    const field = describeField(input.type, input.path.trim());
    if (field) return ok(field);
    if (input.path.trim() === 'design') {
      throw new InputError('unknown-field', `'${input.type}' has no design card yet`, {
        path: '/path', expected: { values: designCardTypes() },
        suggest: `Design cards exist for ${designCardTypes().join(', ')}. Describe ${input.type} without path for its use cases.`,
      });
    }
    const top = topLevelFields(input.type);
    const matches = matchingFieldPaths(input.type, input.path.trim().split('.').at(-1)!);
    throw new InputError('unknown-field', `'${input.type}' has no field '${input.path}'`, {
      path: '/path',
      expected: { values: matches.paths.length ? matches.paths : [...top.options, ...top.data.map((name) => `data.${name}`)],
        ...(matches.paths.length ? { example: matches.example } : {}) },
      suggest: matches.paths.length ? `Use ${matches.paths.join(' or ')}. Example: boardplot describe ${input.type} --path ${matches.paths[0]}.`
        : 'Pass one of the listed fields, or a path below one, such as valueAxis.break or data.series[].values.',
    });
  }
  return ok(describeType(input.type, detail));
}
