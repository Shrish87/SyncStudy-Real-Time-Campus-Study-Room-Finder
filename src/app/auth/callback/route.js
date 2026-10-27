import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '../../../lib/supabaseServer';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const params = new URL(request.url).searchParams;
  const code = params.get('code');

  if (!code || params.has('error')) {
    console.error('OAuth callback problem:', {
        hasCode: Boolean(code),
        error: params.get('error'),
        errorCode: params.get('error_code'),
    });
    }

  let destination = '/login?error=oauth_failed';

  if (code && !params.has('error')) {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    
    if (error) {
        console.error('OAuth exchange failed:', error.code, error.message);
    }

    if (!error) {
      destination = '/';
    }
  }

  const response = NextResponse.redirect(
    new URL(destination, request.url)
  );

  response.headers.set('Cache-Control', 'private, no-store');

  return response;
}