-- Blog automatizado de SEO (docs/specs/blog-seo.md). Idempotente.
--
-- El blog escribe artículos que primero informan y al final presentan AI Tickets, elegidos por keywords con demanda
-- real: Search Console (lo que ya nos busca la gente y dónde aparecemos), Keyword Planner de Google Ads (volumen y
-- competencia en Chile) y el autocompletado de Google. Código: netlify/lib/blog/*, funciones blog-tick (programada)
-- y blog-background, páginas src/pages/blog y herramientas *_blog_* del MCP de administración.
--
-- 1) aitickets_blog_topics: los grupos temáticos (clusters). kind = niche (tipo de evento: teatro, stand-up…) o
--    feature (funcionalidad: preventa, check-in, promotores…). weight = cuota de artículos del tema (se normaliza
--    entre los activos). landing_path: la página de AI Tickets a la que lleva el cierre del artículo y el hub.
-- 2) aitickets_blog_keywords: cada búsqueda candidata con sus métricas (planner_* de Keyword Planner, gsc_* de
--    Search Console), la clasificación con IA (intención y relevancia) y score (0-100, netlify/lib/blog/scoring.mjs).
--    status: new → queued (prioridad manual) → used (ya tiene artículo, post_id) | rejected (note dice por qué).
-- 3) aitickets_blog_posts: el artículo en Markdown (se sanitiza al renderizar), FAQ, fuentes, keywords y las métricas
--    de Search Console de su URL (gsc_*, últimos 28 días) con las consultas que la traen (gsc_queries).
-- 4) aitickets_blog_runs: bitácora de cada corrida (keywords, metrics, generate, refresh) con su detalle y costo.
--
-- Todo: RLS sin políticas y REVOKE a anon/authenticated => solo la service role (páginas SSR y funciones).

CREATE TABLE IF NOT EXISTS public.aitickets_blog_topics (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(slug) <= 60),
  kind text NOT NULL CHECK (kind IN ('niche', 'feature')),
  name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
  description text CHECK (description IS NULL OR char_length(description) <= 600),
  landing_path text CHECK (landing_path IS NULL OR landing_path ~ '^/[a-z0-9/-]*$'),
  seed_keywords text[] NOT NULL DEFAULT '{}'::text[],
  weight integer NOT NULL DEFAULT 5 CHECK (weight BETWEEN 0 AND 100),
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS public.aitickets_blog_posts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(slug) <= 90),
  topic_id bigint REFERENCES public.aitickets_blog_topics(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 10 AND 120),
  meta_title text CHECK (meta_title IS NULL OR char_length(meta_title) <= 70),
  description text NOT NULL CHECK (char_length(description) <= 170),
  excerpt text CHECK (excerpt IS NULL OR char_length(excerpt) <= 400),
  body_md text NOT NULL CHECK (char_length(body_md) <= 60000),
  faq jsonb NOT NULL DEFAULT '[]'::jsonb,
  sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  primary_keyword text,
  secondary_keywords text[] NOT NULL DEFAULT '{}'::text[],
  word_count integer,
  quality jsonb,
  generation jsonb,
  published_at timestamptz,
  content_updated_at timestamptz,
  refreshed_at timestamptz,
  refresh_count integer NOT NULL DEFAULT 0,
  gsc_impressions integer,
  gsc_clicks integer,
  gsc_ctr numeric(6, 4),
  gsc_position numeric(6, 2),
  gsc_queries jsonb,
  gsc_updated_at timestamptz
);
CREATE INDEX IF NOT EXISTS aitickets_blog_posts_published_idx ON public.aitickets_blog_posts (published_at DESC) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS aitickets_blog_posts_topic_idx ON public.aitickets_blog_posts (topic_id, status);

CREATE TABLE IF NOT EXISTS public.aitickets_blog_keywords (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  keyword text NOT NULL CHECK (char_length(keyword) BETWEEN 2 AND 120),
  normalized text NOT NULL UNIQUE,
  topic_id bigint REFERENCES public.aitickets_blog_topics(id) ON DELETE SET NULL,
  sources text[] NOT NULL DEFAULT '{}'::text[],
  planner_searches integer,
  planner_competition text CHECK (planner_competition IS NULL OR planner_competition IN ('LOW', 'MEDIUM', 'HIGH', 'UNSPECIFIED', 'UNKNOWN')),
  planner_competition_index integer,
  planner_high_bid_micros bigint,
  gsc_impressions integer,
  gsc_clicks integer,
  gsc_position numeric(6, 2),
  gsc_page text,
  intent text CHECK (intent IS NULL OR intent IN ('informational', 'commercial', 'transactional', 'navigational')),
  relevance smallint CHECK (relevance IS NULL OR relevance BETWEEN 0 AND 100),
  score numeric(6, 2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'queued', 'used', 'rejected')),
  note text CHECK (note IS NULL OR char_length(note) <= 300),
  post_id bigint REFERENCES public.aitickets_blog_posts(id) ON DELETE SET NULL,
  classified_at timestamptz,
  metrics_at timestamptz
);
CREATE INDEX IF NOT EXISTS aitickets_blog_keywords_pick_idx ON public.aitickets_blog_keywords (status, score DESC);
CREATE INDEX IF NOT EXISTS aitickets_blog_keywords_topic_idx ON public.aitickets_blog_keywords (topic_id, status);

CREATE TABLE IF NOT EXISTS public.aitickets_blog_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task text NOT NULL CHECK (task IN ('keywords', 'metrics', 'generate', 'refresh')),
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ok', 'skipped', 'failed')),
  trigger text NOT NULL DEFAULT 'schedule' CHECK (trigger IN ('schedule', 'admin', 'manual')),
  post_id bigint REFERENCES public.aitickets_blog_posts(id) ON DELETE SET NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text CHECK (error IS NULL OR char_length(error) <= 1000),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS aitickets_blog_runs_task_idx ON public.aitickets_blog_runs (task, started_at DESC);

ALTER TABLE public.aitickets_blog_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aitickets_blog_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aitickets_blog_keywords ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aitickets_blog_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.aitickets_blog_topics FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.aitickets_blog_posts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.aitickets_blog_keywords FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.aitickets_blog_runs FROM PUBLIC, anon, authenticated;
-- Supabase otorga ALL sobre secuencias nuevas a anon/authenticated (default privileges): se quitan las de las identity
REVOKE ALL ON SEQUENCE public.aitickets_blog_topics_id_seq FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.aitickets_blog_posts_id_seq FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.aitickets_blog_keywords_id_seq FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.aitickets_blog_runs_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.aitickets_blog_topics_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.aitickets_blog_posts_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.aitickets_blog_keywords_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.aitickets_blog_runs_id_seq TO service_role;

-- Temas iniciales: un nicho por landing vertical y las funcionalidades que la gente busca antes de elegir ticketera.
-- Las semillas son búsquedas informativas (cómo, cuánto, qué): las transaccionales ("ticketera para teatro") ya las
-- cubren las landings. Se ajustan después con upsert_blog_topic sin tocar código.
INSERT INTO public.aitickets_blog_topics (slug, kind, name, description, landing_path, seed_keywords, weight) VALUES
  ('stand-up', 'niche', 'Stand-up y comedia',
   'Cómo montar, difundir y llenar shows de comedia y open mics: line-up, precios, salas y público.',
   '/ticketera-stand-up',
   ARRAY['como organizar un show de stand up', 'open mic stand up', 'como promocionar un show de comedia', 'cuanto cobrar entrada stand up', 'lugares para hacer stand up en santiago'], 7),
  ('teatro', 'niche', 'Teatro independiente',
   'Producción y difusión de obras: temporadas, funciones, prensa, fondos y cómo llenar la sala.',
   '/ticketera-teatro',
   ARRAY['como difundir una obra de teatro', 'como producir una obra de teatro independiente', 'cuanto cobrar entrada obra de teatro', 'fondos para teatro en chile', 'como llenar una sala de teatro'], 7),
  ('musica-en-vivo', 'niche', 'Música en vivo',
   'Conciertos y tocatas: producción, presupuesto, preventas, rider y difusión de bandas y artistas.',
   '/ticketera-musica-en-vivo',
   ARRAY['como organizar un concierto', 'como producir una tocata', 'como promocionar un concierto', 'cuanto cuesta organizar un concierto', 'que es un rider tecnico'], 8),
  ('discotecas', 'niche', 'Clubs y discotecas',
   'Cómo llenar la pista: RRPP, listas, cover, mesas, noches temáticas y control de puerta.',
   '/ticketera-discotecas',
   ARRAY['como llenar una discoteca', 'marketing para discotecas', 'como ser rrpp de discoteca', 'que es la lista free', 'ideas de fiestas tematicas para discoteca'], 7),
  ('fiestas', 'niche', 'Fiestas',
   'Fiestas masivas, universitarias y temáticas: permisos, preventas por etapas, promotores y seguridad.',
   '/ticketera-fiestas',
   ARRAY['como organizar una fiesta masiva', 'como organizar una fiesta universitaria', 'permisos para una fiesta en chile', 'cuanto cobrar entrada a una fiesta', 'como promocionar una fiesta'], 7),
  ('seminarios', 'niche', 'Seminarios y congresos',
   'Eventos profesionales: agenda, expositores, auspicios, inscripciones, acreditación y certificados.',
   '/ticketera-seminarios',
   ARRAY['como organizar un seminario', 'como organizar un congreso', 'como conseguir auspiciadores para un evento', 'acreditacion de asistentes a un evento', 'como hacer un evento corporativo'], 6),
  ('talleres', 'niche', 'Talleres y cursos',
   'Talleres presenciales: precio, cupos, inscripciones, recordatorios y cómo llenar cada fecha.',
   '/ticketera-talleres',
   ARRAY['como organizar un taller', 'cuanto cobrar por un taller', 'como promocionar un taller', 'como vender cursos presenciales', 'ideas de talleres para emprender'], 6),
  ('academias', 'niche', 'Academias',
   'Muestras, recitales y galas de fin de año de academias de danza, música y artes.',
   '/academias',
   ARRAY['como organizar una muestra de fin de año', 'como organizar un recital de danza', 'gala de fin de año academia de danza', 'como cobrar entradas para un recital', 'ideas para muestra de academia'], 5),
  ('vender-entradas', 'feature', 'Vender entradas online',
   'Todo sobre vender entradas por internet en Chile: medios de pago, cargos, boletas y plataformas.',
   '/vender-entradas-online',
   ARRAY['como vender entradas online', 'plataformas para vender entradas en chile', 'como cobrar entradas por internet', 'cuanto cobran las ticketeras en chile', 'como crear un evento para vender entradas'], 9),
  ('control-de-acceso', 'feature', 'Check-in y control de acceso',
   'Entradas con QR, listas de invitados, puerta sin señal y cómo evitar entradas falsas o duplicadas.',
   '/entradas-con-qr',
   ARRAY['como hacer check in en un evento', 'control de acceso para eventos', 'entradas con codigo qr', 'como evitar entradas falsas', 'lista de invitados para eventos'], 7),
  ('promotores', 'feature', 'Promotores y canales de venta',
   'Trabajar con RRPP y promotores, links con seguimiento y cómo saber qué canal vende tus entradas.',
   '/ventas-por-promotor',
   ARRAY['como trabajar con promotores de eventos', 'cuanto ganan los rrpp', 'que son los parametros utm', 'comision de un promotor de eventos', 'como medir las ventas por canal'], 7),
  ('marketing-de-eventos', 'feature', 'Marketing y difusión',
   'Difusión en Instagram, TikTok y Meta Ads, calendario de contenido y campañas para vender entradas.',
   '/organizadores',
   ARRAY['como promocionar un evento en instagram', 'marketing de eventos', 'publicidad en instagram para eventos', 'estrategia de difusion de un evento', 'ideas de contenido para promocionar un evento'], 9),
  ('precios-y-preventa', 'feature', 'Precios y preventas',
   'Cómo poner precio a las entradas, armar preventas por etapas y usar códigos de descuento sin perder margen.',
   '/precios',
   ARRAY['como hacer una preventa de entradas', 'como poner precio a las entradas de un evento', 'codigos de descuento para eventos', 'que es early bird', 'precio de entradas por etapas'], 7),
  ('produccion-y-finanzas', 'feature', 'Producción y finanzas del evento',
   'Presupuesto, punto de equilibrio, permisos, boletas e impuestos de la venta de entradas en Chile.',
   '/precios',
   ARRAY['presupuesto para un evento', 'punto de equilibrio de un evento', 'boleta por venta de entradas en chile', 'permisos municipales para eventos', 'checklist para organizar un evento'], 6)
ON CONFLICT (slug) DO NOTHING;
