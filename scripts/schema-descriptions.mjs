import { createRequire } from 'node:module';
import { join, resolve, sep } from 'node:path';

/** Put description strings in the catalogue. Every entry still uses the same Zod objects. */
export function schemaDescriptionsPlugin(root) {
  return {
    name: 'schema-descriptions',
    setup(build) {
      const ts = createRequire(join(root, 'package.json'))('typescript');
      const core = resolve(root, 'src/core');
      const program = ts.createProgram([join(root, 'src/index.ts'), join(root, 'src/react/spec.tsx')], {
        moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX,
      });
      const checker = program.getTypeChecker();
      const runtime = JSON.stringify(join(core, 'schema/descriptionWords.ts'));
      const modules = new Map();
      const slots = new Map();
      function slot(value) {
        if (!slots.has(value)) slots.set(value, slots.size);
        return slots.get(value);
      }
      const token = text => text ? '\x01' + slot(text) + '\x02' : '';
      const marked = (node, tag) => node?.getFullText().slice(0, node.getLeadingTriviaWidth()).includes(tag);

      const files = program.getSourceFiles().filter(file => resolve(file.fileName).startsWith(core + sep));
      for (const file of files.sort((a, b) => a.fileName < b.fileName ? -1 : a.fileName > b.fileName ? 1 : 0)) {
        const edits = [];
        const replace = (node, text) => edits.push([node.getStart(file), node.end, text]);
        // Only substitute prose. Conditions, function arguments such as a column
        // id, and the order in which a schema reads another field stay intact.
        function prose(node) {
          if (ts.isStringLiteralLike(node)) replace(node, JSON.stringify(token(node.text)));
          else if (ts.isTemplateExpression(node)) {
            replace(node.head, '`' + token(node.head.text) + '${');
            for (const { expression, literal } of node.templateSpans) {
              prose(expression);
              replace(literal, '}' + token(literal.text) + (literal.kind === ts.SyntaxKind.TemplateTail ? '`' : '${'));
            }
          } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
            prose(node.left);
            prose(node.right);
          } else if (ts.isConditionalExpression(node)) {
            prose(node.whenTrue);
            prose(node.whenFalse);
          } else if (ts.isParenthesizedExpression(node)) prose(node.expression);
        }
        function visit(node) {
          if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'describe') {
            const arg = node.arguments[0];
            if (marked(arg, '@validationHint')) {
              ts.forEachChild(node, visit);
              return;
            }
            replace(node.expression.name, 'meta');
            if (ts.isStringLiteralLike(arg)) replace(arg, `schemaWords.field(${slot(arg.text)})`);
            else {
              // Wrap the value, including any wording supplied by a shared builder.
              edits.push([arg.getStart(file), arg.getStart(file), 'schemaWords.composed('], [arg.end, arg.end, ')']);
              prose(arg);
            }
          } else if (ts.isCallExpression(node) && node.arguments.some(ts.isStringLiteralLike)) {
            const params = checker.getResolvedSignature(node)?.declaration?.parameters;
            node.arguments.forEach((arg, i) => { if (marked(params?.[i], '@schemaText')) prose(arg); });
          } else if (ts.isExpression(node) && marked(node, '@schemaText')) {
            prose(node);
            return;
          }
          if (ts.isExpression(node) && marked(node, '@schemaSnapshot')) {
            edits.push([node.getStart(file), node.getStart(file), 'schemaWords.snapshot('], [node.end, node.end, ')']);
          }
          ts.forEachChild(node, visit);
        }
        visit(file);
        if (!edits.length) continue;
        let source = file.text;
        for (const [start, end, text] of edits.sort((a, b) => b[0] - a[0] || b[1] - a[1])) {
          source = source.slice(0, start) + text + source.slice(end);
        }
        const imports = source.includes('schemaWords.') ? `import * as schemaWords from ${runtime};\n` : '';
        modules.set(resolve(file.fileName), imports + source);
      }
      // One string with a line per text compresses better than an array literal.
      const texts = [...slots.keys()];
      const broken = texts.find(text => text.includes('\n'));
      if (broken) throw new Error(`schema-descriptions: a description holds a line break: ${broken}`);
      build.onLoad({ filter: /[/\\]src[/\\]core[/\\].*\.ts$/ }, ({ path }) => {
        if (path === join(core, 'schema/linkDescriptions.ts')) return { contents: `
          import { install } from ${runtime};
          const dictionary = ${JSON.stringify(texts.join('\n'))}.split('\\n');
          export function linkSchemaDescriptions() {
            install(dictionary);
          }`, loader: 'ts' };
        if (modules.has(path)) return { contents: modules.get(path), loader: 'ts' };
      });
    },
  };
}
