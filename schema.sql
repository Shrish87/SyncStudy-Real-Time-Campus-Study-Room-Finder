-- Database Schema, Triggers, and RLS for SyncStudy

-- Enable RLS on all public tables
ALTER TABLE public.study_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_stats ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to update study room participant counts
CREATE POLICY "Allow students to update room participant count"
ON study_rooms FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

-- Allow authenticated room creation
CREATE POLICY "Allow authenticated room creation"
ON public.study_rooms FOR INSERT
TO authenticated WITH CHECK (auth.uid() = created_by);

-- Function to handle missing full_name in Google OAuth payloads
CREATE OR REPLACE FUNCTION public.handle_new_user_stats() 
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_stats (user_id, full_name)
  VALUES (
    new.id, 
    COALESCE(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', 'Student')
  );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user_stats();
  
-- Enable Realtime for the study_rooms table
ALTER PUBLICATION supabase_realtime ADD TABLE study_rooms;

-- Add tracking for screen sharing feature
ALTER TABLE public.study_rooms ADD COLUMN active_screen_sharers uuid[] DEFAULT '{}';
