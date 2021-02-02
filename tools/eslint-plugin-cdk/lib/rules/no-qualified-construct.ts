//
// This rule ensures that the `@aws-cdk/core.Construct` class is always
// referenced without a namespace qualifier (`Construct` instead of
// `xxx.Construct`). The fixer will automatically add an `import` statement
// separated from the main import group to reduce the chance for merge conflicts
// with v2-main. 
//
// If there is already an import of `constructs.Construct` under the name
// `Construct`, we will import `core.Construct` as the alias `CoreConstruct`
// instead.
//

import { Node } from 'estree';
import { AST, Rule } from 'eslint';
import { ImportCache } from '../private/import-cache';

interface ImportOrderViolation {
  node: Node;
  range: [number, number];
}

const importCache = new ImportCache();
let importOrderViolation: ImportOrderViolation | undefined;

export function create(context: Rule.RuleContext): Rule.NodeListener {
  // skip core
  if (context.getFilename().includes('@aws-cdk/core')) {
    return {};
  }

  return {
    Program: _ => {
      // reset for every file
      importOrderViolation = undefined;
    },

    // collect all "import" statements. we will later use them to determine
    // exactly how to import `core.Construct`.
    ImportDeclaration: node => {
      for (const [i, s] of node.specifiers.entries()) {
        const typeName = () => {
          switch (s.type) {
            case 'ImportSpecifier': return s.imported.name;
            case 'ImportDefaultSpecifier': return s.local.name;
            case 'ImportNamespaceSpecifier': return s.local.name;
          }
        };

        if (s.local.name === 'CoreConstruct' && s.range) {
          if (node.specifiers.length > 1) {
            // if there is more than one specifier on the line that also imports CoreConstruct, i.e.,
            // `import { Resource, Construct as CoreConstruct, Token } from '@aws-cdk/core'`

            // If this is the last specifier, delete just that. If not, delete until the beginning of the next specifier.
            const range: [number, number] = (i === node.specifiers.length - 1) ? s.range : [s.range[0], node.specifiers[i + 1].range![0]];
            importOrderViolation = { node, range };
          }
        }

        importCache.record({
          fileName: context.getFilename(),
          typeName: typeName(),
          importNode: node,
          localName: `${node.source.value}.${s.local.name}`
        });
      }
    },

    // this captures `class X extends xxx.Construct`
    ClassDeclaration: node => {
      if (node.superClass?.type === 'MemberExpression') {
        const sc = node.superClass;
        const baseClass = sc.property.type === 'Identifier' ? sc.property.name : undefined;
        if (baseClass === 'Construct' && sc.range) {
          report(context, node, sc.range);
        }
        if (baseClass === 'CoreConstruct') {
          reportImportOrderViolations(context);
        }
      }
    },

    // this captures using `xxx.Construct` as an identifier
    Identifier: node => {
      const typeAnnotation = (node as any).typeAnnotation?.typeAnnotation;
      const type = typeAnnotation?.typeName;
      if (type?.type === 'TSQualifiedName' && type?.right.name === 'Construct' && type?.left.name !== 'constructs') {
        report(context, node, typeAnnotation.range);
      }
      if (node.name === 'CoreConstruct') {
        reportImportOrderViolations(context);
      }
    },
  }
}

function reportImportOrderViolations(context: Rule.RuleContext) {
  if (importOrderViolation) {
    const violation = importOrderViolation;
    context.report({
      message: 'To avoid merge conflicts with the v2 branch, "CoreConstruct" import should be in its own line',
      node: violation.node,
      fix: fixer => {
        const fixes: Rule.Fix[] = [];

        fixes.push(fixer.removeRange(violation.range));
        const imports = importCache.imports.filter(x => x.fileName === context.getFilename());
        const lastImport = imports[imports.length - 1];
        fixes.push(fixer.insertTextAfter(lastImport.importNode, [
          "",
          "",
          "// keep this import separate from other imports to reduce chance for merge conflicts with v2-main",
          "// eslint-disable-next-line no-duplicate-imports, import/order",
          "import { Construct as CoreConstruct } from '@aws-cdk/core'",
        ].join('\n')));
        return fixes;
      }
    });
  }
}

/**
 * Reports an error indicating that we found `xxx.Construct` usage, and apply
 * the appropriate fix.
 * @param context Rule context
 * @param node Rule node (for the report)
 * @param replaceRange Text range to replace
 */
function report(context: Rule.RuleContext, node: Rule.Node, replaceRange: AST.Range) {
  context.report({
    message: 'To avoid merge conflicts with the v2-main branch, the "Construct" type must be referenced without a qualifier (e.g. "Construct" instead of "CoreConstruct")',
    node,
    fix: fixer => {
      const imports = importCache.imports.filter(x => x.fileName === context.getFilename());
      const findImport = (x: string) => imports.find(i => i.localName === x);

      const coreConstruct = findImport('@aws-cdk/core.Construct')
      const coreCoreConstruct = findImport('@aws-cdk/core.CoreConstruct');
      const constructsConstruct = findImport('constructs.Construct');

      // determines whether we will replace with `Construct` or `CoreConstruct`
      // based on whether this file already imported `constructs.Construct`.
      let replaceBy: string | undefined;

      // determines whether an "import" statement should be added and it's
      // contents.
      let addImport: string | undefined;

      if (coreConstruct) {
        // we already import `core.Construct` as `Construct`
        replaceBy = 'Construct';
      } else if (coreCoreConstruct) {
        // we already import `core.Construct` as `CoreConstruct`
        replaceBy = 'CoreConstruct'
      } else if (constructsConstruct) {
        // we import `constructs.Construct`, so import and replace
        // `core.Construct` with `CoreConstruct`
        replaceBy = 'CoreConstruct';
        addImport = `import { Construct as ${replaceBy} } from '@aws-cdk/core';`;
      } else {
        // import `core.Construct` as `Construct` and replace
        replaceBy = 'Construct';
        addImport = `import { ${replaceBy} } from '@aws-cdk/core';`;
      }

      const fixes: Rule.Fix[] = [
        fixer.replaceTextRange(replaceRange, replaceBy)
      ];

      if (addImport) {
        // find the last import statement in the file and add our import immediately after
        const lastImport = imports[imports.length - 1];
        if (lastImport) {
          fixes.push(fixer.insertTextAfter(lastImport.importNode, [
            "",
            "",
            "// keep this import separate from other imports to reduce chance for merge conflicts with v2-main",
            "// eslint-disable-next-line no-duplicate-imports, import/order",
            addImport,
          ].join('\n')));
        }
      }

      return fixes;
    },
  });
}