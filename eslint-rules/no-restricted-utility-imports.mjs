const noRestrictedUtilityImportsRule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'disallow importing of redundant third-party utility packages (lodash, bcrypt, uuid) and suggest native alternatives',
      category: 'Best Practices',
      recommended: true,
    },
    schema: [],
    messages: {
      restrictedImport: 'Importing "{{ name }}" is not allowed. {{ suggestion }}',
    },
  },
  create(context) {
    function checkImportPath(node, importPath) {
      if (!importPath || typeof importPath !== 'string') return;

      const normalizedPath = importPath.trim();

      let matchedPackage = null;
      let suggestion = '';

      if (
        normalizedPath === 'lodash' ||
        normalizedPath.startsWith('lodash/') ||
        normalizedPath === 'lodash-es' ||
        normalizedPath.startsWith('lodash-es/')
      ) {
        matchedPackage = 'lodash';
        suggestion = 'Use modern native standard Array (e.g., Array.prototype.map, filter, reduce), Object (e.g., Object.keys, values, entries), and String methods instead.';
      } else if (
        normalizedPath === 'bcrypt' ||
        normalizedPath.startsWith('bcrypt/')
      ) {
        matchedPackage = 'bcrypt';
        suggestion = 'Use native Node.js/Web Crypto APIs or custom scrypt-based password helpers (e.g., src/utils/password.ts) instead.';
      } else if (
        normalizedPath === 'uuid' ||
        normalizedPath.startsWith('uuid/')
      ) {
        matchedPackage = 'uuid';
        suggestion = 'Use native standard crypto.randomUUID() instead.';
      }

      if (matchedPackage) {
        context.report({
          node,
          messageId: 'restrictedImport',
          data: {
            name: normalizedPath,
            suggestion,
          },
        });
      }
    }

    return {
      ImportDeclaration(node) {
        checkImportPath(node.source, node.source.value);
      },
      ExportNamedDeclaration(node) {
        if (node.source) {
          checkImportPath(node.source, node.source.value);
        }
      },
      ExportAllDeclaration(node) {
        if (node.source) {
          checkImportPath(node.source, node.source.value);
        }
      },
      ImportExpression(node) {
        if (node.source) {
          if (node.source.type === 'Literal') {
            checkImportPath(node.source, node.source.value);
          } else if (node.source.type === 'TemplateLiteral' && node.source.quasis.length === 1) {
            checkImportPath(node.source, node.source.quasis[0].value.cooked);
          }
        }
      },
      CallExpression(node) {
        if (
          node.callee &&
          node.callee.type === 'Identifier' &&
          node.callee.name === 'require' &&
          node.arguments.length === 1
        ) {
          const arg = node.arguments[0];
          if (arg.type === 'Literal') {
            checkImportPath(arg, arg.value);
          } else if (arg.type === 'TemplateLiteral' && arg.quasis.length === 1) {
            checkImportPath(arg, arg.quasis[0].value.cooked);
          }
        }
      },
    };
  },
};

export default noRestrictedUtilityImportsRule;
