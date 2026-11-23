import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import { renderToStaticMarkup } from 'react-dom/server';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import GlobalError from '../global-error';
import { metadata as notFoundMetadata } from '../not-found';

const APP_DIR = path.resolve(process.cwd(), 'src/app');

function collectPageFiles(dirPath: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'api' || entry.name === '__tests__') {
        continue;
      }
      results.push(...collectPageFiles(fullPath));
    } else if (entry.isFile() && entry.name === 'page.tsx') {
      results.push(fullPath);
    }
  }

  return results;
}

function parseSourceFile(filePath: string): ts.SourceFile {
  const content = fs.readFileSync(filePath, 'utf8');
  return ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
}

function hasUseClientDirective(sf: ts.SourceFile): boolean {
  for (const stmt of sf.statements) {
    if (!ts.isExpressionStatement(stmt)) {
      break;
    }
    if (ts.isStringLiteralLike(stmt.expression) && stmt.expression.text === 'use client') {
      return true;
    }
  }
  return false;
}

interface ExtractedMetadataInfo {
  hasMetadataExport: boolean;
  title: string | null;
  noIndex: boolean;
}

function extractObjectPropertyInitializer(
  obj: ts.ObjectLiteralExpression,
  propName: string
): ts.Expression | undefined {
  for (const prop of obj.properties) {
    if (
      ts.isPropertyAssignment(prop) &&
      (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)) &&
      prop.name.text === propName
    ) {
      return prop.initializer;
    }
  }
  return undefined;
}

function extractStringOrTemplatePrefix(expr: ts.Expression | undefined): string | null {
  if (!expr) {
    return null;
  }
  if (ts.isStringLiteralLike(expr)) {
    return expr.text;
  }
  if (ts.isTemplateExpression(expr)) {
    return `${expr.head.text}{dynamic}`;
  }
  return null;
}

function extractMetadataFromSourceFile(sf: ts.SourceFile): ExtractedMetadataInfo {
  let hasMetadataExport = false;
  let title: string | null = null;
  let noIndex = false;

  for (const stmt of sf.statements) {
    const isExported = Boolean(
      ts.canHaveModifiers(stmt) &&
      ts.getModifiers(stmt)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    );

    if (isExported && ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.name.text === 'metadata' && decl.initializer) {
          hasMetadataExport = true;
          let init = decl.initializer;
          while (
            ts.isAsExpression(init) ||
            ts.isSatisfiesExpression(init) ||
            ts.isParenthesizedExpression(init)
          ) {
            init = init.expression;
          }

          if (
            ts.isCallExpression(init) &&
            ts.isIdentifier(init.expression) &&
            init.expression.text === 'createPageMetadata' &&
            init.arguments.length > 0 &&
            ts.isObjectLiteralExpression(init.arguments[0])
          ) {
            const opts = init.arguments[0];
            title = extractStringOrTemplatePrefix(extractObjectPropertyInitializer(opts, 'title'));
            const noIndexInit = extractObjectPropertyInitializer(opts, 'noIndex');
            noIndex = Boolean(noIndexInit && noIndexInit.kind === ts.SyntaxKind.TrueKeyword);
          } else if (ts.isObjectLiteralExpression(init)) {
            title = extractStringOrTemplatePrefix(extractObjectPropertyInitializer(init, 'title'));
            const robotsInit = extractObjectPropertyInitializer(init, 'robots');
            if (robotsInit && ts.isObjectLiteralExpression(robotsInit)) {
              const indexProp = extractObjectPropertyInitializer(robotsInit, 'index');
              noIndex = Boolean(indexProp && indexProp.kind === ts.SyntaxKind.FalseKeyword);
            }
          }
        }
      }
    }

    if (
      isExported &&
      ts.isFunctionDeclaration(stmt) &&
      stmt.name?.text === 'generateMetadata' &&
      stmt.body
    ) {
      hasMetadataExport = true;
      const findReturnedTitle = (node: ts.Node) => {
        if (ts.isReturnStatement(node) && node.expression && ts.isObjectLiteralExpression(node.expression)) {
          const extracted = extractStringOrTemplatePrefix(
            extractObjectPropertyInitializer(node.expression, 'title')
          );
          if (extracted) {
            title = extracted;
          }
        }
        ts.forEachChild(node, findReturnedTitle);
      };
      findReturnedTitle(stmt.body);
    }
  }

  return { hasMetadataExport, title, noIndex };
}

describe('Route and Error Metadata Coverage (WCAG 2.4.2 Page Titled)', () => {
  it('exports unique, descriptive server metadata across all page.tsx routes with no client page modules', () => {
    const pageFiles = collectPageFiles(APP_DIR);
    expect(pageFiles.length).toBeGreaterThanOrEqual(30);

    const titlesByRoute = new Map<string, string>();
    const untitledRoutes: string[] = [];
    const clientPageRoutes: string[] = [];

    for (const filePath of pageFiles) {
      const rel = path.relative(APP_DIR, filePath).replace(/\\/g, '/');
      const segment = rel.replace(/(?:^|\/)page\.tsx$/, '');
      const route = segment ? `/${segment}` : '/';

      const sf = parseSourceFile(filePath);
      if (hasUseClientDirective(sf)) {
        clientPageRoutes.push(route);
      }

      const info = extractMetadataFromSourceFile(sf);
      if (!info.hasMetadataExport || !info.title || !info.title.trim()) {
        untitledRoutes.push(route);
      } else {
        titlesByRoute.set(route, info.title.trim());
      }

      const requiresNoIndex =
        route.startsWith('/admin/') ||
        route === '/guest' ||
        route.startsWith('/guest/') ||
        route === '/registry/add-item' ||
        route.startsWith('/registry/edit-item/');

      if (requiresNoIndex) {
        expect({ route, noIndex: info.noIndex }).toEqual({ route, noIndex: true });
      }
    }

    expect(clientPageRoutes).toEqual([]);
    expect(untitledRoutes).toEqual([]);

    // Verify key required routes explicitly exist and have descriptive titles
    expect(titlesByRoute.get('/admin/setup')).toBe('Initial Site Setup');
    expect(titlesByRoute.get('/admin/dashboard/registry')).toBe('Registry Management');
    expect(titlesByRoute.get('/registry')).toBe('Gift Registry');
    expect(titlesByRoute.get('/registry/add-item')).toBe('Add Registry Item');
    expect(titlesByRoute.get('/registry/edit-item/[id]')).toBe('Edit Registry Item');
    expect(titlesByRoute.get('/guest/login')).toBe('Guest Sign-In');
    expect(titlesByRoute.get('/guest')).toBe('Guest RSVP & Address Portal');
    expect(titlesByRoute.get('/guest/collect')).toBe('Mailing Address Form');
    expect(titlesByRoute.get('/project-info')).toBe('About This Project');

    // Verify every route title is distinct
    const seenTitles = new Map<string, string>();
    for (const [route, routeTitle] of titlesByRoute.entries()) {
      expect(seenTitles.get(routeTitle)).toBeUndefined();
      seenTitles.set(routeTitle, route);
    }
  });

  it('exports Page Not Found metadata with noIndex on src/app/not-found.tsx', () => {
    const notFoundPath = path.join(APP_DIR, 'not-found.tsx');
    const sf = parseSourceFile(notFoundPath);

    expect(hasUseClientDirective(sf)).toBe(false);
    const info = extractMetadataFromSourceFile(sf);
    expect(info).toEqual({
      hasMetadataExport: true,
      title: 'Page Not Found',
      noIndex: true,
    });
    expect(notFoundMetadata).toMatchObject({
      title: 'Page Not Found',
      robots: {
        index: false,
        follow: false,
      },
    });
  });

  it('renders <html lang="en"> with <head><title>Critical Application Error</title></head> and syncs document.title in GlobalError', () => {
    const globalErrorPath = path.join(APP_DIR, 'global-error.tsx');
    const sf = parseSourceFile(globalErrorPath);

    let hasHtmlLangEn = false;
    let hasTitleInHead = false;
    let hasDocumentTitleSync = false;

    const visit = (node: ts.Node) => {
      if (ts.isJsxElement(node)) {
        const tag = node.openingElement.tagName.getText(sf);
        if (tag === 'html') {
          for (const attr of node.openingElement.attributes.properties) {
            if (
              ts.isJsxAttribute(attr) &&
              attr.name.getText(sf) === 'lang' &&
              attr.initializer &&
              ts.isStringLiteral(attr.initializer) &&
              attr.initializer.text === 'en'
            ) {
              hasHtmlLangEn = true;
            }
          }
        }
        if (tag === 'head') {
          for (const child of node.children) {
            if (ts.isJsxElement(child) && child.openingElement.tagName.getText(sf) === 'title') {
              hasTitleInHead = child.children.length > 0;
            }
          }
        }
      }
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isPropertyAccessExpression(node.left) &&
        ts.isIdentifier(node.left.expression) &&
        node.left.expression.text === 'document' &&
        node.left.name.text === 'title'
      ) {
        hasDocumentTitleSync = true;
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);

    expect(hasHtmlLangEn).toBe(true);
    expect(hasTitleInHead).toBe(true);
    expect(hasDocumentTitleSync).toBe(true);

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const resetMock = jest.fn();
      const fatalError = new Error('Fatal root crash');

      const markup = renderToStaticMarkup(<GlobalError error={fatalError} reset={resetMock} />);
      expect(markup).toContain('<html lang="en">');
      expect(markup).toMatch(/<head>.*<title>Critical Application Error<\/title>.*<\/head>/);

      document.title = 'Previous Title';
      render(<GlobalError error={fatalError} reset={resetMock} />);
      expect(document.title).toBe('Critical Application Error');

      fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
      expect(resetMock).toHaveBeenCalledTimes(1);
    } finally {
      consoleSpy.mockRestore();
    }
  });
});
