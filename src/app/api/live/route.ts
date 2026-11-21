import { NextResponse } from 'next/server';

/**
 * @public
 * @description Process liveness probe endpoint. Returns HTTP 200 without querying PostgreSQL so transient database blips do not trigger container restart loops.
 */
export async function GET() {
  return NextResponse.json(
    {
      status: 'alive',
      timestamp: new Date().toISOString(),
    },
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
      },
    }
  );
}
