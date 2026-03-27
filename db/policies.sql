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

-- EVENT_VISITS POLICIES
ALTER TABLE public.event_visits ENABLE ROW LEVEL SECURITY;

-- Allow anonymous inserts for visit tracking (public event pages)
CREATE POLICY "Enable insert for anonymous visit tracking" ON "public"."event_visits"
AS PERMISSIVE FOR INSERT
TO anon
WITH CHECK (true);

-- Allow authenticated org members to read visit data for their events
CREATE POLICY "Enable read for org event owners" ON "public"."event_visits"
AS PERMISSIVE FOR SELECT
TO authenticated
USING (
  event_id IN (
    SELECT e.id FROM public.events e
    JOIN public.users u ON u.organization_id = e.organization_id
    WHERE u.auth_user_id = auth.uid()
  )
);

-- SOCIAL_ACCOUNTS POLICIES
ALTER TABLE public.social_accounts ENABLE ROW LEVEL SECURITY;

-- Allow org members to read their own social accounts
CREATE POLICY "Enable read for org members" ON "public"."social_accounts"
AS PERMISSIVE FOR SELECT
TO authenticated
USING (
  organization_id IN (
    SELECT organization_id FROM public.users
    WHERE auth_user_id = auth.uid()
  )
);

-- Allow org members to insert social accounts for their org
CREATE POLICY "Enable insert for org members" ON "public"."social_accounts"
AS PERMISSIVE FOR INSERT
TO authenticated
WITH CHECK (
  organization_id IN (
    SELECT organization_id FROM public.users
    WHERE auth_user_id = auth.uid()
  )
);

-- Allow org members to update their social accounts
CREATE POLICY "Enable update for org members" ON "public"."social_accounts"
AS PERMISSIVE FOR UPDATE
TO authenticated
USING (
  organization_id IN (
    SELECT organization_id FROM public.users
    WHERE auth_user_id = auth.uid()
  )
);

-- Allow org members to delete their social accounts
CREATE POLICY "Enable delete for org members" ON "public"."social_accounts"
AS PERMISSIVE FOR DELETE
TO authenticated
USING (
  organization_id IN (
    SELECT organization_id FROM public.users
    WHERE auth_user_id = auth.uid()
  )
);

-- SOCIAL_POSTS POLICIES
ALTER TABLE public.social_posts ENABLE ROW LEVEL SECURITY;

-- Allow org members to read their own social posts
CREATE POLICY "Enable read for org members" ON "public"."social_posts"
AS PERMISSIVE FOR SELECT
TO authenticated
USING (
  organization_id IN (
    SELECT organization_id FROM public.users
    WHERE auth_user_id = auth.uid()
  )
);

-- Allow org members to insert social posts for their org
CREATE POLICY "Enable insert for org members" ON "public"."social_posts"
AS PERMISSIVE FOR INSERT
TO authenticated
WITH CHECK (
  organization_id IN (
    SELECT organization_id FROM public.users
    WHERE auth_user_id = auth.uid()
  )
);

-- Allow org members to update their social posts
CREATE POLICY "Enable update for org members" ON "public"."social_posts"
AS PERMISSIVE FOR UPDATE
TO authenticated
USING (
  organization_id IN (
    SELECT organization_id FROM public.users
    WHERE auth_user_id = auth.uid()
  )
);

-- Allow org members to delete their social posts
CREATE POLICY "Enable delete for org members" ON "public"."social_posts"
AS PERMISSIVE FOR DELETE
TO authenticated
USING (
  organization_id IN (
    SELECT organization_id FROM public.users
    WHERE auth_user_id = auth.uid()
  )
);

-- AD_ACCOUNT_CONNECTIONS POLICIES
ALTER TABLE public.ad_account_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read for org members" ON "public"."ad_account_connections"
AS PERMISSIVE FOR SELECT
TO authenticated
USING (
  organization_id IN (
    SELECT organization_id FROM public.users
    WHERE auth_user_id = auth.uid()
  )
);

CREATE POLICY "Enable insert for org members" ON "public"."ad_account_connections"
AS PERMISSIVE FOR INSERT
TO authenticated
WITH CHECK (
  organization_id IN (
    SELECT organization_id FROM public.users
    WHERE auth_user_id = auth.uid()
  )
);

CREATE POLICY "Enable update for org members" ON "public"."ad_account_connections"
AS PERMISSIVE FOR UPDATE
TO authenticated
USING (
  organization_id IN (
    SELECT organization_id FROM public.users
    WHERE auth_user_id = auth.uid()
  )
);

CREATE POLICY "Enable delete for org members" ON "public"."ad_account_connections"
AS PERMISSIVE FOR DELETE
TO authenticated
USING (
  organization_id IN (
    SELECT organization_id FROM public.users
    WHERE auth_user_id = auth.uid()
  )
);

-- AD_CAMPAIGNS POLICIES
ALTER TABLE public.ad_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read for org members" ON "public"."ad_campaigns"
AS PERMISSIVE FOR SELECT
TO authenticated
USING (
  organization_id IN (
    SELECT organization_id FROM public.users
    WHERE auth_user_id = auth.uid()
  )
);

CREATE POLICY "Enable insert for org members" ON "public"."ad_campaigns"
AS PERMISSIVE FOR INSERT
TO authenticated
WITH CHECK (
  organization_id IN (
    SELECT organization_id FROM public.users
    WHERE auth_user_id = auth.uid()
  )
);

CREATE POLICY "Enable update for org members" ON "public"."ad_campaigns"
AS PERMISSIVE FOR UPDATE
TO authenticated
USING (
  organization_id IN (
    SELECT organization_id FROM public.users
    WHERE auth_user_id = auth.uid()
  )
);

CREATE POLICY "Enable delete for org members" ON "public"."ad_campaigns"
AS PERMISSIVE FOR DELETE
TO authenticated
USING (
  organization_id IN (
    SELECT organization_id FROM public.users
    WHERE auth_user_id = auth.uid()
  )
);
