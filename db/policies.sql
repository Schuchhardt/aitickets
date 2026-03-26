-- Enable RLS on tables
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- ORGANIZATIONS POLICIES

-- Allow everyone to read organizations (needed for event pages)
CREATE POLICY "Enable read access for all users" ON "public"."organizations"
AS PERMISSIVE FOR SELECT
TO public
USING (true);

-- Allow authenticated users to insert their own organization (if flow allows)
-- Note: Registration API uses Service Role, so this is optional but good practice.
CREATE POLICY "Enable insert for authenticated users" ON "public"."organizations"
AS PERMISSIVE FOR INSERT
TO authenticated
WITH CHECK (true);

-- Allow users to update their own organization
-- Note: Requires logic linking user -> organization.
-- Since users.organization_id -> organizations.id, we check if the executing user
-- has a 'users' record linked to this org.
CREATE POLICY "Enable update for organization owners" ON "public"."organizations"
AS PERMISSIVE FOR UPDATE
TO authenticated
USING (
  id IN (
    SELECT organization_id FROM public.users 
    WHERE auth_user_id = auth.uid()
  )
)
WITH CHECK (
  id IN (
    SELECT organization_id FROM public.users 
    WHERE auth_user_id = auth.uid()
  )
);

-- USERS POLICIES

-- Allow users to read their own profile
CREATE POLICY "Enable read access for own profile" ON "public"."users"
AS PERMISSIVE FOR SELECT
TO authenticated
USING (auth_user_id = auth.uid());

-- Allow users to update their own profile
CREATE POLICY "Enable update for own profile" ON "public"."users"
AS PERMISSIVE FOR UPDATE
TO authenticated
USING (auth_user_id = auth.uid());
