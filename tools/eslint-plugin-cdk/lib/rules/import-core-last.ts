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

import { Rule } from 'eslint';

let coreConstructSeen: boolean;

export function create(context: Rule.RuleContext): Rule.NodeListener {
  return {
    Program: _ => {
      // reset for every new file
      coreConstructSeen = false;
    },

    ImportDeclaration: node => {
      for (const s of node.specifiers) {
        const typeName = () => {
          switch (s.type) {
            case 'ImportSpecifier': return s.imported.name;
            case 'ImportDefaultSpecifier': return s.local.name;
            case 'ImportNamespaceSpecifier': return s.local.name;
          }
        };

        if (coreConstructSeen) { // No imports after importing CoreConstruct
          context.report({
            message: 'heyhey',
            node,
          });
        }

        if (typeName() === 'CoreConstruct') {
          if (node.specifiers.length > 1) { // The line importing CoreConstruct should not import anything else.
            context.report({
              message: 'hey',
              node,
            });
          }
          coreConstructSeen = true;
        }
      }
    },
  }
}