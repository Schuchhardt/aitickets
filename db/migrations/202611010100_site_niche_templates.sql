-- Plantillas por nicho del sitio del productor (src/lib/siteTemplates.ts): teatro, música, fiestas, clubs, stand-up,
-- seminarios, talleres y academias, además de las cuatro originales. Las secciones viven en content.sections (jsonb
-- existente): no hay columnas nuevas.
ALTER TABLE public.aitickets_sites DROP CONSTRAINT IF EXISTS aitickets_sites_template_check;
ALTER TABLE public.aitickets_sites ADD CONSTRAINT aitickets_sites_template_check CHECK (
  template IN (
    'clasico', 'nocturno', 'minimal', 'festival',
    'teatro', 'musica', 'fiestas', 'clubs', 'standup', 'seminarios', 'talleres', 'academias'
  )
);
