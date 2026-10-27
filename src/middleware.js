import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export async function middleware(request) {
  const changedCookies = [];
  const refreshHeaders = {};

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },

        setAll(updates, headers = {}) {
          updates.forEach((cookie) => {
            request.cookies.set(cookie.name, cookie.value);
            changedCookies.push(cookie);
          });

          Object.assign(refreshHeaders, headers);
        },
      },
    }
  );

  const { data: { user }, error } = await supabase.auth.getUser();

  const response = !error && user
    ? NextResponse.next({ request })
    : NextResponse.redirect(new URL('/login', request.url));

  changedCookies.forEach(({ name, value, options }) => {
    response.cookies.set(name, value, options);
  });

  Object.entries(refreshHeaders).forEach(([name, value]) => {
    response.headers.set(name, value);
  });

  response.headers.set('Cache-Control', 'private, no-store');

  return response;
}

export const config = {
  matcher: ['/'],
};