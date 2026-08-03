import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withApiMiddleware } from './withApiMiddleware';

interface ValidatedRouteConfig<T extends z.ZodTypeAny = any, L extends z.ZodTypeAny = any> {
  schema?: T | ((params: any) => T);
  legacySchema?: L | ((params: any) => L);
  translateLegacy?: (legacyBody: z.infer<L>) => z.infer<T>;
  handler: (
    req: NextRequest,
    context: { params: any; body: z.infer<T> }
  ) => Promise<Response> | Response;
}

export function createValidatedRoute<T extends z.ZodTypeAny, L extends z.ZodTypeAny = any>(config: ValidatedRouteConfig<T, L>) {
  const baseHandler = async (req: NextRequest, context: any) => {
    let body: any = null;
    let params = context?.params || {};
    
    // In Next.js app router, context.params can be a Promise
    if (params instanceof Promise) {
      params = await params;
    }

    const versionHeader = req.headers.get('x-api-version') || req.headers.get('X-API-Version');
    const url = req.nextUrl || (req.url ? new URL(req.url) : null);
    const versionParam = url?.searchParams?.get?.('version');
    const isLegacy = (versionHeader === 'v1' || versionParam === 'v1');

    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      try {
        body = await req.clone().json();
      } catch (e) {
        return NextResponse.json(
          { success: false, error: 'Invalid JSON payload' },
          { status: 400 }
        );
      }

      if (isLegacy && config.legacySchema) {
        let resolvedLegacySchema: z.ZodTypeAny;
        if (typeof config.legacySchema === 'function') {
          resolvedLegacySchema = (config.legacySchema as any)(params);
        } else {
          resolvedLegacySchema = config.legacySchema;
        }

        const result = resolvedLegacySchema.safeParse(body);
        if (!result.success) {
          return NextResponse.json(
            { 
              success: false, 
              error: 'Validation Error', 
              details: result.error.format() 
            },
            { status: 400 }
          );
        }
        if (config.translateLegacy) {
          body = config.translateLegacy(result.data as any);
        } else {
          body = result.data;
        }
      } else if (config.schema) {
        let resolvedSchema: z.ZodTypeAny;
        if (typeof config.schema === 'function') {
          resolvedSchema = (config.schema as any)(params);
        } else {
          resolvedSchema = config.schema;
        }

        const result = resolvedSchema.safeParse(body);
        if (!result.success) {
          return NextResponse.json(
            { 
              success: false, 
              error: 'Validation Error', 
              details: result.error.format() 
            },
            { status: 400 }
          );
        }
        body = result.data;
      }
    }

    const enhancedContext = {
      ...context,
      params,
      body,
    };

    return config.handler(req, enhancedContext);
  };

  const wrapped = withApiMiddleware(baseHandler);
  
  // Expose configuration metadata programmatically for potential future use or generators
  (wrapped as any).config = config;
  (wrapped as any).schema = config.schema;

  return wrapped;
}
