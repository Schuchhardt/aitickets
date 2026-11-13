-- Propuestas para leads (create_lead_proposal del MCP Admin) y correcciones de log_lead_touch.
-- Idempotente. Solo toca objetos de AI Tickets.
--
-- 1. proposal_preview_link_id era bigint, pero aitickets_event_preview_links.id es uuid: nada podía guardarse
--    ahí. Nunca se escribió (create_lead_proposal no existía), así que se convierte sin datos que migrar.
-- 2. reply_gmail_message_id: el id del correo de RESPUESTA. log_lead_touch(replied) pisaba gmail_message_id
--    (el del correo enviado) con el de la respuesta y se perdía el id del envío.
-- 3. Organización "Propuestas AI Tickets": dueña de los eventos borrador que se arman como propuesta para un
--    lead. Se crea una sola vez y su id queda en aitickets_platform_settings ('proposals_org_id'), igual que el
--    usuario de soporte. Sin usuarios: solo se opera con el MCP Admin (org_* / create_lead_proposal).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'aitickets_leads'
      AND column_name = 'proposal_preview_link_id' AND data_type = 'bigint'
  ) THEN
    ALTER TABLE public.aitickets_leads ALTER COLUMN proposal_preview_link_id TYPE uuid USING NULL::uuid;
  END IF;
END
$$;

ALTER TABLE public.aitickets_lead_touches ADD COLUMN IF NOT EXISTS reply_gmail_message_id text;

-- Si alguna organización se insertó con id explícito, la secuencia de organizations.id puede ir atrás y el
-- INSERT chocaría con la PK (23505). Solo se adelanta, nunca se retrocede.
DO $$
DECLARE oid bigint; seq text; max_id bigint; last_id bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.aitickets_platform_settings WHERE key = 'proposals_org_id') THEN
    SELECT id INTO oid FROM public.organizations WHERE public_name = 'Propuestas AI Tickets' ORDER BY id LIMIT 1;
    IF oid IS NULL THEN
      seq := pg_get_serial_sequence('public.organizations', 'id');
      IF seq IS NOT NULL THEN
        SELECT COALESCE(max(id), 0) INTO max_id FROM public.organizations;
        SELECT COALESCE(s.last_value, 0) INTO last_id FROM pg_sequences s
          WHERE format('%I.%I', s.schemaname, s.sequencename) = seq;
        IF max_id > COALESCE(last_id, 0) THEN
          PERFORM setval(seq, max_id);
        END IF;
      END IF;
      INSERT INTO public.organizations (public_name, country)
      VALUES ('Propuestas AI Tickets', 'CL')
      RETURNING id INTO oid;
    END IF;
    INSERT INTO public.aitickets_platform_settings (key, value) VALUES ('proposals_org_id', to_jsonb(oid));
  END IF;
END
$$;
