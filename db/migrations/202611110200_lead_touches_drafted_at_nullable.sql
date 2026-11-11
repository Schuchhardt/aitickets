-- log_lead_touch inserta drafted_at = null en los touches que no son borradores
-- (sent, replied, bounced, discarded): un envío importado de Gmail o una respuesta
-- no tienen borrador. Con NOT NULL esos inserts fallaban y la secuencia nunca avanzaba.
-- Se quita también el DEFAULT now() para que un touch sin borrador no quede con una
-- fecha de borrador inventada.

ALTER TABLE public.aitickets_lead_touches ALTER COLUMN drafted_at DROP NOT NULL;
ALTER TABLE public.aitickets_lead_touches ALTER COLUMN drafted_at DROP DEFAULT;
