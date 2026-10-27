import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '../lib/supabaseServer';
import SyncStudyClient from './SyncStudyClient';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    redirect('/login');
  }

  const initialUser = {
    id: user.id,
    email: user.email,
    user_metadata: {
      full_name: user.user_metadata?.full_name ?? null,
    },
  };

  return <SyncStudyClient initialUser={initialUser} />;
}