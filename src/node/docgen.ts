import ts from 'typescript';
import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ApiProp, Control } from '../index.js';

const caches = new Map<
  string,
  { program: ts.Program; versions: Map<string, number> }
>();
function inferred(type: ts.Type): Control | undefined {
  const variants = type.isUnion()
    ? type.types.filter(
        (item) => !(item.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null)),
      )
    : [type];
  if (variants.some((item) => item.getCallSignatures().length > 0))
    return undefined;
  if (
    variants.length > 0 &&
    variants.every((item) => item.isStringLiteral() || item.isNumberLiteral())
  )
    return {
      type:
        variants.length > 1
          ? 'select'
          : variants[0].isStringLiteral()
            ? 'text'
            : 'number',
      ...(variants.length > 1
        ? {
            options: variants.map((item) => item.value),
          }
        : {}),
    };
  const flags = variants.reduce((value, item) => value | item.flags, 0);
  if (flags & ts.TypeFlags.BooleanLike) return { type: 'boolean' };
  if (flags & ts.TypeFlags.NumberLike) return { type: 'number' };
  if (flags & ts.TypeFlags.StringLike) return { type: 'text' };
  if (!type.getCallSignatures().length && flags & ts.TypeFlags.Object)
    return { type: 'json' };
  return undefined;
}
export function extractApi(
  root: string,
  files: string[],
): Map<string, ApiProp[]> {
  const names = files
    .filter((file) => /\.examples\.[jt]sx?$/.test(file))
    .map((file) => resolve(root, file).replaceAll('\\', '/'));
  if (!names.length) return new Map();
  let cache = caches.get(root);
  const priorCache = cache;
  const valid =
    priorCache &&
    names.every((name) => priorCache.versions.has(name)) &&
    [...priorCache.versions].every(([name, version]) => {
      try {
        return statSync(name).mtimeMs === version;
      } catch {
        return false;
      }
    });
  if (!valid || !cache) {
    const configFile = ts.findConfigFile(root, (path) =>
      ts.sys.fileExists(path),
    );
    const parsed = configFile
      ? ts.parseJsonConfigFileContent(
          ts.readConfigFile(configFile, (path) => ts.sys.readFile(path)).config,
          ts.sys,
          root,
        )
      : null;
    const options: ts.CompilerOptions = {
      ...parsed?.options,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      allowJs: true,
      skipLibCheck: true,
      noEmit: true,
      strictNullChecks: true,
    };
    const program = ts.createProgram(names, options);
    const versions = new Map(
      program
        .getSourceFiles()
        .filter((file) => !file.fileName.includes('node_modules'))
        .map((file) => [
          file.fileName.replaceAll('\\', '/'),
          statSync(file.fileName).mtimeMs,
        ]),
    );
    cache = { program, versions };
    caches.set(root, cache);
  }
  const program = cache.program,
    checker = program.getTypeChecker(),
    output = new Map<string, ApiProp[]>();
  for (const name of names) {
    const file = program.getSourceFile(name);
    if (!file) continue;
    const variables = new Map<string, ts.Expression>();
    function visit(node: ts.Node) {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer
      )
        variables.set(node.name.text, node.initializer);
      ts.forEachChild(node, visit);
    }
    visit(file);
    let definition = file.statements.find(ts.isExportAssignment)?.expression;
    for (let depth = 0; definition && depth < 8; depth++) {
      if (ts.isIdentifier(definition))
        definition = variables.get(definition.text);
      else if (ts.isCallExpression(definition))
        definition = definition.arguments[0];
      else if (
        ts.isSatisfiesExpression(definition) ||
        ts.isAsExpression(definition) ||
        ts.isParenthesizedExpression(definition)
      )
        definition = definition.expression;
      else break;
    }
    if (!definition || !ts.isObjectLiteralExpression(definition)) continue;
    const objectDefinition = definition;
    const property = (key: string) =>
      objectDefinition.properties.find(
        (item) =>
          item.name &&
          (ts.isIdentifier(item.name) || ts.isStringLiteral(item.name)) &&
          item.name.text === key,
      );
    const main = property('component'),
      children = property('subcomponents');
    const components: { key: string; component: ts.Expression }[] = [];
    if (main && ts.isPropertyAssignment(main))
      components.push({ key: name, component: main.initializer });
    if (
      children &&
      ts.isPropertyAssignment(children) &&
      ts.isObjectLiteralExpression(children.initializer)
    )
      for (const child of children.initializer.properties) {
        if (
          ts.isPropertyAssignment(child) ||
          ts.isShorthandPropertyAssignment(child)
        )
          components.push({
            key:
              name + '#' + child.name.getText(file).replace(/^['"]|['"]$/g, ''),
            component: ts.isPropertyAssignment(child)
              ? child.initializer
              : child.name,
          });
      }
    for (const { key, component } of components) {
      const type = checker.getTypeAtLocation(component);
      const signature = type.getCallSignatures().at(0);
      const parameter = signature?.parameters.at(0);
      let props = parameter
        ? checker.getTypeOfSymbolAtLocation(parameter, component)
        : undefined;
      if (!props && type.getConstructSignatures()[0])
        props = checker.getTypeOfSymbolAtLocation(
          type.getConstructSignatures()[0].parameters[0],
          component,
        );
      if (!props) continue;
      const entries: ApiProp[] = [];
      for (const prop of props.getProperties()) {
        const declarations = prop.getDeclarations() ?? [];
        if (
          !declarations.length ||
          declarations.every((item) =>
            /node_modules[/]@types[/]react|lib\.dom\.d\.ts/.test(
              item.getSourceFile().fileName.replaceAll('\\', '/'),
            ),
          )
        )
          continue;
        const propType = checker.getTypeOfSymbolAtLocation(prop, component);
        const defaultTag = prop
          .getJsDocTags(checker)
          .find((tag) => tag.name === 'default' || tag.name === 'defaultValue');
        let defaultValue = defaultTag?.text?.map((part) => part.text).join('');
        const componentDeclaration = signature?.declaration;
        if (
          !defaultValue &&
          componentDeclaration &&
          'parameters' in componentDeclaration
        ) {
          const binding = componentDeclaration.parameters.at(0)?.name;
          if (binding && ts.isObjectBindingPattern(binding))
            defaultValue = binding.elements
              .find(
                (item) =>
                  (item.propertyName ?? item.name).getText() === prop.name,
              )
              ?.initializer?.getText();
        }
        entries.push({
          name: prop.name,
          type: checker.typeToString(
            propType,
            component,
            ts.TypeFormatFlags.NoTruncation,
          ),
          required: !(prop.flags & ts.SymbolFlags.Optional),
          description: ts.displayPartsToString(
            prop.getDocumentationComment(checker),
          ),
          defaultValue,
          control: inferred(propType),
        });
      }
      output.set(key.replaceAll('\\', '/'), entries);
    }
  }
  return output;
}
