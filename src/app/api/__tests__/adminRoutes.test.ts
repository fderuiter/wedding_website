/** @jest-environment node */

import { NextRequest } from 'next/server';
import { POST as login } from '../admin/login/route';
import { POST as logout } from '../admin/logout/route';
import { GET as me } from '../admin/me/route';

describe('Admin API routes', () => {
  beforeEach(() => {
    process.env.ADMIN_PASSWORD = 'secret';
  });

  test('login succeeds with correct password', async () => {
    const req = new NextRequest('http://localhost/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ password: 'secret' }),
    });
    const res = await login(req);
    expect(res.status).toBe(200);
    expect(res.cookies.get('admin_auth')?.value).toBe('true');
  });

  test('login fails with invalid password', async () => {
    const req = new NextRequest('http://localhost/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ password: 'wrong' }),
    });
    const res = await login(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('Invalid password.');
  });

  test('logout clears auth cookie', async () => {
    const res = await logout();
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('admin_auth=');
    expect(setCookie).toContain('Max-Age=0');
  });

  test('me returns admin status based on cookie', async () => {
    const reqAdmin = new NextRequest('http://localhost/api/admin/me', {
      headers: { cookie: 'admin_auth=true' },
    });
    const resAdmin = await me(reqAdmin);
    const jsonAdmin = await resAdmin.json();
    expect(jsonAdmin.isAdmin).toBe(true);

    const reqAnon = new NextRequest('http://localhost/api/admin/me');
    const resAnon = await me(reqAnon);
    const jsonAnon = await resAnon.json();
    expect(jsonAnon.isAdmin).toBe(false);
  });
});

