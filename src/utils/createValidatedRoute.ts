import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withApiMiddleware } from './withApiMiddleware';

interface ValidatedRouteConfig<T extends z.ZodTypeAny = any> {
  schema?: T | ((params: any) => T);
  handler: (
    req: NextRequest,
    context: { params: any; body: z.infer<T> }
  ) => Promise<Response> | Response;
}

export function createValidatedRoute<T extends z.ZodTypeAny>(config: ValidatedRouteConfig<T>) {
  const baseHandler = async (req: NextRequest, context: any) => {
    let body: any = null;
    let params = context?.params || {};
    
    // In Next.js app router, context.params can be a Promise
    if (params instanceof Promise) {
      params = await params;
    }

    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      try {
        body = await req.clone().json();
      } catch (e) {
        return NextResponse.json(
          { success: false, error: 'Invalid JSON payload' },
          { status: 400 }
        );
      }

      if (config.schema) {
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
