import { pathToFileURL } from 'node:url';
import { resolve as pathResolve } from 'node:path';
import { existsSync } from 'node:fs';

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const rawPath = pathResolve(process.cwd(), 'src', specifier.slice(2));
    let finalPath = rawPath;
    if (!existsSync(rawPath)) {
      if (existsSync(rawPath + '.ts')) {
        finalPath = rawPath + '.ts';
      } else if (existsSync(rawPath + '.tsx')) {
        finalPath = rawPath + '.tsx';
      } else if (existsSync(rawPath + '/index.ts')) {
        finalPath = rawPath + '/index.ts';
      }
    }
    const newSpecifier = pathToFileURL(finalPath).href;
    return nextResolve(newSpecifier, context);
  }
  return nextResolve(specifier, context);
}
