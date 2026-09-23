const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { loadTsModule } = require('./helpers/load-ts-module');

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(filePath);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [filePath] : [];
  });
}

function staticEndpoints(node) {
  if (ts.isStringLiteralLike(node)) return [node.text];
  if (ts.isTemplateExpression(node)) {
    let candidates = [node.head.text];
    for (const span of node.templateSpans) {
      candidates = candidates.flatMap((candidate) => [
        `${candidate}route-id${span.literal.text}`,
        `${candidate}${span.literal.text}`,
      ]);
    }
    return candidates;
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = staticEndpoints(node.left);
    const right = staticEndpoints(node.right);
    if (left === undefined || right === undefined) return undefined;
    return left.flatMap((leftPart) => right.map((rightPart) => leftPart + rightPart));
  }
  return undefined;
}

test('every static apiClient call maps to a reviewed diagnostic route', () => {
  const { safeHttpEndpoint } = loadTsModule('src/observability/http-diagnostics.ts');
  const apiClientModule = path.resolve(process.cwd(), 'src/services/api/client');
  const uncovered = [];
  const dynamic = [];
  const relativeImports = new Set();
  let callCount = 0;

  for (const filePath of sourceFiles(path.join(process.cwd(), 'src'))) {
    const source = fs.readFileSync(filePath, 'utf8');
    const sourceFile = ts.createSourceFile(
      filePath,
      source,
      ts.ScriptTarget.Latest,
      true,
      filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const aliases = new Set();
    for (const statement of sourceFile.statements) {
      if (
        ts.isImportDeclaration(statement) &&
        ts.isStringLiteral(statement.moduleSpecifier) &&
        (statement.moduleSpecifier.text === '@/services/api/client' ||
          path.resolve(path.dirname(filePath), statement.moduleSpecifier.text) === apiClientModule)
      ) {
        if (statement.moduleSpecifier.text.startsWith('.')) relativeImports.add(path.relative(process.cwd(), filePath));
        for (const element of statement.importClause?.namedBindings?.elements ?? []) {
          if ((element.propertyName ?? element.name).text === 'apiClient') {
            aliases.add(element.name.text);
          }
        }
      }
    }
    if (aliases.size === 0) continue;

    const visit = (node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        aliases.has(node.expression.text)
      ) {
        callCount += 1;
        const endpoints = node.arguments[0] && staticEndpoints(node.arguments[0]);
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        const location = `${path.relative(process.cwd(), filePath)}:${line}`;
        if (endpoints === undefined) dynamic.push(location);
        else if (!endpoints.some((endpoint) => safeHttpEndpoint(endpoint) !== '/__other__')) {
          uncovered.push(`${location} -> ${endpoints.join(' | ')}`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  assert.ok(callCount >= 160, `expected broad apiClient coverage, saw ${callCount}`);
  assert.deepEqual([...relativeImports].sort(), ['src/services/api/calls.ts', 'src/services/api/groups.ts', 'src/services/api/notes.ts', 'src/services/api/qr.ts']);
  assert.deepEqual(uncovered, []);
  assert.deepEqual(dynamic, [
    'src/features/location/services/geocoder-fetch.ts:33',
    'src/services/api/utils.ts:65',
  ]);
});
