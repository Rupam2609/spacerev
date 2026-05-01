-- SpaceRev Supabase Schema
-- Run this in Supabase SQL Editor

-- Store all user data as JSON per key
CREATE TABLE IF NOT EXISTS public.user_store (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  key TEXT NOT NULL,
  value JSONB DEFAULT '[]',
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, key)
);

-- Enable RLS
ALTER TABLE public.user_store ENABLE ROW LEVEL SECURITY;

-- Users can only access their own data
DROP POLICY IF EXISTS "Users manage own data" ON public.user_store;
CREATE POLICY "Users manage own data" ON public.user_store
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_user_store_user ON public.user_store(user_id);

-- IMPORTANT: Go to Authentication > Providers > Email
-- and DISABLE "Confirm email" for testing
