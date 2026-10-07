import { http, HttpResponse } from 'msw';

const createCtx = () => ({
  status: (code: number) => (acc: any) => { acc.status = code; },
  json: (data: any) => (acc: any) => {
    acc.body = JSON.stringify(data);
    acc.headers['content-type'] = 'application/json';
  },
  body: (data: string) => (acc: any) => { acc.body = data; },
  text: (data: string) => (acc: any) => { acc.body = data; },
  set: (keyOrObj: string | Record<string, string>, val?: string) => (acc: any) => {
    if (typeof keyOrObj === 'string') {
      acc.headers[keyOrObj.toLowerCase()] = val;
    } else {
      for (const [k, v] of Object.entries(keyOrObj)) {
        acc.headers[k.toLowerCase()] = v;
      }
    }
  },
});

const createRes = () => {
  const resFn = (...funcs: any[]) => {
    const acc = { status: 200, headers: {} as Record<string, string>, body: null as any };
    for (const fn of funcs) {
      if (typeof fn === 'function') fn(acc);
    }
    return new HttpResponse(acc.body, {
      status: acc.status,
      headers: acc.headers,
    });
  };
  resFn.networkError = (_msg?: string) => HttpResponse.error();
  return resFn;
};

const createReq = (request: Request) => ({
  url: new URL(request.url),
  headers: request.headers,
  json: () => request.clone().json(),
  text: () => request.clone().text(),
});

type Resolver = (req: any, res: any, ctx: any) => any;

export const rest = {
  get: (path: string, resolver: Resolver) => {
    return http.get(path, async ({ request }) => {
      const res = createRes();
      const ctx = createCtx();
      const req = createReq(request);
      return await resolver(req, res, ctx);
    });
  },
  post: (path: string, resolver: Resolver) => {
    return http.post(path, async ({ request }) => {
      const res = createRes();
      const ctx = createCtx();
      const req = createReq(request);
      return await resolver(req, res, ctx);
    });
  },
  put: (path: string, resolver: Resolver) => {
    return http.put(path, async ({ request }) => {
      const res = createRes();
      const ctx = createCtx();
      const req = createReq(request);
      return await resolver(req, res, ctx);
    });
  },
  delete: (path: string, resolver: Resolver) => {
    return http.delete(path, async ({ request }) => {
      const res = createRes();
      const ctx = createCtx();
      const req = createReq(request);
      return await resolver(req, res, ctx);
    });
  },
};
