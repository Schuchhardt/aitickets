-- Initial schema for aitickets
-- Generated from Supabase Dashboard on 2025-12-12

-- Independent tables first (no foreign keys to other tables)

CREATE TABLE public.attendees (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  first_name text,
  last_name text,
  email text,
  phone text,
  last_access_at timestamp with time zone,
  CONSTRAINT attendees_pkey PRIMARY KEY (id)
);

CREATE TABLE public.category_tags (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  name character varying NOT NULL UNIQUE,
  CONSTRAINT category_tags_pkey PRIMARY KEY (id)
);

CREATE TABLE public.newsletter (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  email text UNIQUE,
  ip character varying,
  country character varying,
  language text,
  timezone text,
  user_agent text,
  referrer text,
  CONSTRAINT newsletter_pkey PRIMARY KEY (id)
);

CREATE TABLE public.organizations (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  legal_name text,
  public_name text NOT NULL,
  legal_id text,
  phone text,
  email text,
  website text,
  instagram text,
  facebook text,
  linkedin text,
  tiktok text,
  country text,
  CONSTRAINT organizations_pkey PRIMARY KEY (id)
);

CREATE TABLE public.venues (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text DEFAULT regexp_replace(lower(name), '[^a-z0-9]+'::text, '-'::text, 'g'::text),
  address_line1 text,
  address_line2 text,
  city text,
  state_province text,
  postal_code text,
  country_code character,
  latitude numeric,
  longitude numeric,
  timezone text,
  capacity integer,
  contact_email text,
  contact_phone text,
  website_url text,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT venues_pkey PRIMARY KEY (id)
);

-- Tables with dependencies on organizations

CREATE TABLE public.users (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  name text,
  email text UNIQUE,
  phone text,
  encrypted_password text,
  active boolean DEFAULT true,
  last_access_at timestamp with time zone,
  organization_id bigint,
  login_count integer NOT NULL DEFAULT 0,
  updated_at timestamp with time zone,
  role text DEFAULT 'admin'::text,
  auth_user_id uuid,
  CONSTRAINT users_pkey PRIMARY KEY (id),
  CONSTRAINT users_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id),
  CONSTRAINT users_auth_user_id_fkey FOREIGN KEY (auth_user_id) REFERENCES auth.users(id)
);

CREATE TABLE public.events (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  image_url text,
  name text,
  description text,
  location text,
  capacity bigint,
  status text DEFAULT 'draft'::text,
  accessibility text,
  created_at timestamp with time zone DEFAULT now(),
  created_by bigint,
  slug text,
  title text,
  start_date timestamp with time zone,
  end_date timestamp with time zone,
  organization_id bigint,
  secret_location text,
  CONSTRAINT events_pkey PRIMARY KEY (id),
  CONSTRAINT events_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id)
);

-- Tables with dependencies on events

CREATE TABLE public.event_tickets (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  event_id bigint NOT NULL,
  ticket_name text NOT NULL,
  price numeric NOT NULL,
  max_quantity integer,
  is_gift boolean DEFAULT false,
  status text DEFAULT 'available'::text,
  init_date timestamp with time zone,
  end_date timestamp with time zone,
  total_quantity integer,
  CONSTRAINT event_tickets_pkey PRIMARY KEY (id),
  CONSTRAINT event_tickets_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id)
);

CREATE TABLE public.event_locations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  event_id bigint NOT NULL,
  venue_id uuid NOT NULL,
  name text,
  display_name text,
  capacity_override integer,
  entrance_instructions text,
  access_notes text,
  address_line1_override text,
  address_line2_override text,
  city_override text,
  state_province_override text,
  postal_code_override text,
  country_code_override character,
  latitude_override numeric,
  longitude_override numeric,
  is_virtual boolean NOT NULL DEFAULT false,
  stream_url text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT event_locations_pkey PRIMARY KEY (id),
  CONSTRAINT event_locations_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id),
  CONSTRAINT event_locations_venue_id_fkey FOREIGN KEY (venue_id) REFERENCES public.venues(id)
);

CREATE TABLE public.event_orders (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  status text,
  event_id bigint NOT NULL,
  attendee_id bigint NOT NULL,
  amount bigint NOT NULL,
  payment_fee bigint,
  total_payment bigint,
  payment_commerce_id text,
  payment_external_id text,
  ticket_qty integer,
  ticket_fee bigint,
  balance bigint,
  ticket_details jsonb,
  CONSTRAINT event_orders_pkey PRIMARY KEY (id),
  CONSTRAINT event_orders_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id),
  CONSTRAINT event_orders_attendee_id_fkey FOREIGN KEY (attendee_id) REFERENCES public.attendees(id)
);

CREATE TABLE public.event_faqs (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  event_id bigint NOT NULL,
  question text NOT NULL,
  answer text NOT NULL,
  CONSTRAINT event_faqs_pkey PRIMARY KEY (id),
  CONSTRAINT event_faqs_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id)
);

CREATE TABLE public.event_tags (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  event_id bigint,
  tag_id bigint,
  CONSTRAINT event_tags_pkey PRIMARY KEY (id),
  CONSTRAINT event_tags_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id),
  CONSTRAINT event_tags_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES public.category_tags(id)
);

CREATE TABLE public.event_withdrawals (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  event_id bigint NOT NULL,
  user_id bigint NOT NULL,
  amount numeric NOT NULL,
  status text NOT NULL DEFAULT 'requested'::text,
  estimated_payment_date date,
  paid_at timestamp with time zone,
  account_number text NOT NULL,
  bank_name text NOT NULL,
  account_holder_name text NOT NULL,
  account_holder_rut text NOT NULL,
  CONSTRAINT event_withdrawals_pkey PRIMARY KEY (id),
  CONSTRAINT event_withdrawals_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id),
  CONSTRAINT event_withdrawals_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id)
);

CREATE TABLE public.questions (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  event_id bigint,
  question text,
  user_name text,
  user_email text,
  CONSTRAINT questions_pkey PRIMARY KEY (id),
  CONSTRAINT questions_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id)
);

CREATE TABLE public.event_dates (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  event_id bigint NOT NULL,
  date date NOT NULL,
  start_time time without time zone NOT NULL,
  end_time time without time zone,
  event_location_id uuid,
  CONSTRAINT event_dates_pkey PRIMARY KEY (id),
  CONSTRAINT event_dates_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id),
  CONSTRAINT event_dates_event_location_id_fkey FOREIGN KEY (event_location_id) REFERENCES public.event_locations(id)
);

-- Tables with multiple dependencies (created last)

CREATE TABLE public.event_attendees (
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  event_id bigint,
  event_ticket_id bigint,
  attendee_id bigint,
  qr_code text,
  is_complimentary boolean,
  status text,
  id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  event_order_id uuid,
  validated_at timestamp with time zone,
  CONSTRAINT event_attendees_pkey PRIMARY KEY (id),
  CONSTRAINT event_attendees_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id),
  CONSTRAINT event_attendees_event_ticket_id_fkey FOREIGN KEY (event_ticket_id) REFERENCES public.event_tickets(id),
  CONSTRAINT event_attendees_attendee_id_fkey FOREIGN KEY (attendee_id) REFERENCES public.attendees(id),
  CONSTRAINT event_attendees_event_order_id_fkey FOREIGN KEY (event_order_id) REFERENCES public.event_orders(id)
);
