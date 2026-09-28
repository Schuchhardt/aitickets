# Deploy del cargo por servicio con IVA separado (feat/fee-iva-legal)

## Qué cambia en el cobro

Desde este deploy, Flow cobra `amount + ticket_fee + service_fee_tax`
(subtotal + cargo neto del 10% + IVA 19% del cargo). La migración
`db/migrations/202609290100_service_fee_tax.sql` es compatible con el código anterior
(la columna tiene default 0 y el RPC guarda 0 si no se envía).

## Si se hace rollback del código

El código anterior espera solo `amount + ticket_fee`. Una orden creada por el código nuevo
que se pague (o se reconcilie) después del rollback no calza con ese monto y queda en
`status = 'review'` sin emitir entradas. El dinero está cobrado: hay que confirmarlas a mano.

Checklist después de un rollback (y durante unas horas después, por pagos tardíos y la
reconciliación de expire-pending-orders):

1. Buscar las órdenes afectadas (solo lectura):

   ```sql
   select id, event_id, payment_provider, amount, ticket_fee, service_fee_tax, created_at
     from public.event_orders
    where status = 'review'
      and coalesce(service_fee_tax, 0) > 0
    order by created_at;
   ```

2. Para cada una, verificar en Flow que lo pagado sea exactamente
   `amount + ticket_fee + service_fee_tax`.
3. Si calza, confirmarla manualmente (emitir entradas y enviar el correo) como cualquier orden en revisión.
4. Volver a desplegar el código nuevo apenas se pueda: `expectedPaymentAmounts` acepta ambos montos.
