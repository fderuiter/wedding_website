import path from 'path';
import fs from 'fs';
import ts from 'typescript';

const fileCache = new Map();
const extensions = ['.tsx', '.ts', '.jsx', '.js'];

function getCommentText(comment) {
  if (!comment) return '';
  if (typeof comment === 'string') return comment;
  if (Array.isArray(comment)) {
    return comment.map(part => part.text).join('');
  }
  if (typeof comment === 'object' && comment.text) {
    return comment.text;
  }
  return '';
}

function resolveFilePath(resolvedPath) {
  // 1. If it's a file directly
  if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile()) {
    return resolvedPath;
  }
  // 2. Try with extensions
  for (const ext of extensions) {
    const p = resolvedPath + ext;
    if (fs.existsSync(p) && fs.statSync(p).isFile()) {
      return p;
    }
  }
  // 3. Try directory index
  for (const ext of extensions) {
    const p = path.join(resolvedPath, 'index' + ext);
    if (fs.existsSync(p) && fs.statSync(p).isFile()) {
      return p;
    }
  }
  return null;
}

function getDeprecationsForFile(filePath) {
  if (fileCache.has(filePath)) {
    return fileCache.get(filePath);
  }

  const result = {
    isModuleDeprecated: false,
    moduleDeprecationMessage: '',
    deprecatedMembers: new Map() // memberName -> deprecationMessage
  };

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);

    // 1. Check for file-level (module) deprecation in leading comments of the file
    const leadingComments = ts.getLeadingCommentRanges(content, 0);
    if (leadingComments) {
      for (const comment of leadingComments) {
        const commentText = content.substring(comment.pos, comment.end);
        if (commentText.includes('@deprecated')) {
          const match = commentText.match(/@deprecated\s+([\s\S]*?)(?:\*\/|$)/);
          if (match) {
            const msg = match[1].replace(/^\s*\*+/gm, '').trim();
            result.isModuleDeprecated = true;
            result.moduleDeprecationMessage = msg;
            break;
          }
        }
      }
    }

    // 2. Collect local declarations with @deprecated
    const localDeprecatedNames = new Map();

    function visit(node) {
      const tags = ts.getJSDocTags(node);
      const deprecatedTag = tags.find(tag => tag.tagName.text === 'deprecated');
      if (deprecatedTag) {
        const msg = getCommentText(deprecatedTag.comment).trim();

        if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
          if (node.name && ts.isIdentifier(node.name)) {
            localDeprecatedNames.set(node.name.text, msg);
          }
        } else if (ts.isVariableStatement(node)) {
          for (const decl of node.declarationList.declarations) {
            if (ts.isIdentifier(decl.name)) {
              localDeprecatedNames.set(decl.name.text, msg);
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    }

    ts.forEachChild(sourceFile, visit);

    // If first statement of the file has JSDoc @deprecated and is NOT exported,
    // treat it as module-level deprecation
    if (!result.isModuleDeprecated && sourceFile.statements.length > 0) {
      const firstStatement = sourceFile.statements[0];
      const tags = ts.getJSDocTags(firstStatement);
      const deprecatedTag = tags.find(tag => tag.tagName.text === 'deprecated');
      if (deprecatedTag) {
        const isExported = (ts.getCombinedModifierFlags(firstStatement) & ts.ModifierFlags.Export) !== 0;
        if (!isExported) {
          result.isModuleDeprecated = true;
          result.moduleDeprecationMessage = getCommentText(deprecatedTag.comment).trim();
        }
      }
    }

    // Now check exports to map them to deprecatedMembers
    for (const statement of sourceFile.statements) {
      const isExported = (ts.getCombinedModifierFlags(statement) & ts.ModifierFlags.Export) !== 0;
      const isDefault = (ts.getCombinedModifierFlags(statement) & ts.ModifierFlags.Default) !== 0;

      if (isExported) {
        if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
          if (statement.name && ts.isIdentifier(statement.name)) {
            const name = statement.name.text;
            if (localDeprecatedNames.has(name)) {
              const msg = localDeprecatedNames.get(name);
              if (isDefault) {
                result.deprecatedMembers.set('default', msg);
              } else {
                result.deprecatedMembers.set(name, msg);
              }
            }
          }
        } else if (ts.isVariableStatement(statement)) {
          for (const decl of statement.declarationList.declarations) {
            if (ts.isIdentifier(decl.name)) {
              const name = decl.name.text;
              if (localDeprecatedNames.has(name)) {
                const msg = localDeprecatedNames.get(name);
                result.deprecatedMembers.set(name, msg);
              }
            }
          }
        }
      }

      if (ts.isExportAssignment(statement)) {
        const expr = statement.expression;
        let msg = '';
        const tags = ts.getJSDocTags(statement);
        const deprecatedTag = tags.find(tag => tag.tagName.text === 'deprecated');
        if (deprecatedTag) {
          msg = getCommentText(deprecatedTag.comment).trim();
        } else if (ts.isIdentifier(expr) && localDeprecatedNames.has(expr.text)) {
          msg = localDeprecatedNames.get(expr.text);
        }

        if (msg !== undefined) {
          result.deprecatedMembers.set('default', msg);
        }
      }

      if (ts.isExportDeclaration(statement)) {
        if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
          for (const spec of statement.exportClause.elements) {
            const localName = spec.propertyName ? spec.propertyName.text : spec.name.text;
            const exportName = spec.name.text;
            let msg = '';
            const tags = ts.getJSDocTags(spec);
            const deprecatedTag = tags.find(tag => tag.tagName.text === 'deprecated');
            if (deprecatedTag) {
              msg = getCommentText(deprecatedTag.comment).trim();
            } else if (localDeprecatedNames.has(localName)) {
              msg = localDeprecatedNames.get(localName);
            }

            if (msg !== undefined) {
              result.deprecatedMembers.set(exportName, msg);
            }
          }
        }
      }
    }

  } catch (error) {
    console.error(`[no-deprecated-imports] Error parsing file ${filePath}:`, error);
  }

  fileCache.set(filePath, result);
  return result;
}

const noDeprecatedImportsRule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'disallow importing of deprecated shared modules or members',
      category: 'Best Practices',
      recommended: false,
    },
    schema: [],
    messages: {
      deprecatedModule: 'Import of deprecated module "{{ name }}" is deprecated: {{ message }}',
      deprecatedSpecifier: 'Import of deprecated member "{{ name }}" from "{{ module }}" is deprecated: {{ message }}',
    },
  },
  create(context) {
    return {
      ImportDeclaration(node) {
        const importPath = node.source.value;
        const currentFile = context.filename || context.getFilename();

        // 1. Resolve absolute path of import
        let resolvedPath = null;
        if (importPath.startsWith('@/')) {
          resolvedPath = path.resolve('/app', 'src', importPath.slice(2));
        } else if (importPath.startsWith('./') || importPath.startsWith('../')) {
          resolvedPath = path.resolve(path.dirname(currentFile), importPath);
        } else {
          return;
        }

        // 2. Only check if target is inside shared folders: components, utils, lib, hooks
        const SHARED_DIRS = ['src/components/', 'src/utils/', 'src/lib/', 'src/hooks/'];
        const absoluteSharedDirs = SHARED_DIRS.map(dir => path.join('/app', dir));
        const isShared = absoluteSharedDirs.some(sharedDir => resolvedPath.startsWith(sharedDir));
        if (!isShared) {
          return;
        }

        // 3. Find physical file on disk
        const targetFilePath = resolveFilePath(resolvedPath);
        if (!targetFilePath) {
          return;
        }

        // 4. Extract JSDoc deprecations
        const deprecations = getDeprecationsForFile(targetFilePath);

        // Scenario A: Module is deprecated
        if (deprecations.isModuleDeprecated) {
          context.report({
            node: node.source,
            messageId: 'deprecatedModule',
            data: {
              name: importPath,
              message: deprecations.moduleDeprecationMessage || 'No migration instructions provided.',
            },
          });
          return;
        }

        // Scenario B: Individual members are deprecated
        for (const specifier of node.specifiers) {
          if (specifier.type === 'ImportDefaultSpecifier') {
            if (deprecations.deprecatedMembers.has('default')) {
              const msg = deprecations.deprecatedMembers.get('default');
              context.report({
                node: specifier,
                messageId: 'deprecatedSpecifier',
                data: {
                  name: specifier.local.name,
                  module: importPath,
                  message: msg || 'No migration instructions provided.',
                },
              });
            }
          } else if (specifier.type === 'ImportSpecifier') {
            const importedName = specifier.imported.name;
            if (deprecations.deprecatedMembers.has(importedName)) {
              const msg = deprecations.deprecatedMembers.get(importedName);
              context.report({
                node: specifier,
                messageId: 'deprecatedSpecifier',
                data: {
                  name: importedName,
                  module: importPath,
                  message: msg || 'No migration instructions provided.',
                },
              });
            }
          }
        }
      },
    };
  },
};

export default noDeprecatedImportsRule;
