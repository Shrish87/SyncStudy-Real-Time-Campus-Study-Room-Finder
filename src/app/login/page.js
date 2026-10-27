'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';

export default function LoginPage() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    if (params.has('error')) {
      setError('Sign-in failed. Please try your authorized college account.');
    }
  }, []);

  async function handleLogin() {
    setError('');
    setBusy(true);

    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });

      if (error) throw error;
    } catch {
      setError('Unable to sign in. Please try again.');
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="bg-white p-8 rounded-xl shadow-lg text-center max-w-md w-full">
        <h1 className="text-3xl font-bold text-gray-900 mb-6">
          SyncStudy
        </h1>

        {error && (
          <p role="alert" className="text-red-600 mb-4">
            {error}
          </p>
        )}

        <button
          onClick={handleLogin}
          disabled={busy}
          className="w-full bg-indigo-600 text-white py-3 rounded-lg disabled:opacity-60"
        >
          {busy ? 'Opening Google…' : 'Continue with Google (@ssn.edu.in)'}
        </button>
      </div>
    </main>
  );
}