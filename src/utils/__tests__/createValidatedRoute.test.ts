/** @jest-environment node */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createValidatedRoute } from '../createValidatedRoute';

test('createValidatedRoute exports a function', () => {
  expect(typeof createValidatedRoute).toBe('function');
});

test('createValidatedRoute returns HTTP 400 with _errors arrays in details when validation fails', async () => {
  const route = createValidatedRoute({
    schema: z.object({
      title: z.string().min(1, 'Title is required'),
    }),
    handler: async (_req, { body }) => NextResponse.json({ ok: true, title: body.title }),
  });

  const req = new Request('http://localhost/api/guest/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '' }),
  }) as unknown as NextRequest;

  const res = await route(req, { params: {} });
  expect(res.status).toBe(400);
  const payload = await res.json();
  expect(payload.success).toBe(false);
  expect(payload.error).toBe('Validation Error');
  expect(payload.details._errors).toEqual([]);
  expect(payload.details.title._errors).toEqual(['Title is required']);
});
