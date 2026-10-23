# Runbook: verificar cuentas bancarias, pagar retiros y cerrar reembolsos

Hasta que exista el MCP de administración (`docs/specs/mcp-admin.md`), estas tareas se hacen desde
**Supabase > SQL editor** con las funciones de `db/migrations/202610240100_payout_ops.sql`. Cada aviso de Slack
trae el SQL listo con los ids reales: solo hay que completar lo que va entre `< >`.

Nunca actualices a mano `aitickets_payouts`, `event_withdrawals`, `aitickets_refunds` ni las columnas de
verificación de `organization_payout_accounts`: las funciones validan las transiciones y mantienen las tablas
sincronizadas. (Si igual se actualiza `aitickets_payouts` a mano, un trigger copia el estado a `event_withdrawals`.)

## Verificar una cuenta bancaria (aviso "🏦 Cuenta bancaria por verificar")

```sql
select * from organization_payout_accounts where organization_id = 57;            -- revisar los datos
select aitickets_verify_payout_account(57, 'approve', 'seba', null, '6789');       -- aprobar
select aitickets_verify_payout_account(57, 'reject', 'seba', 'El titular no coincide con el RUT', '6789');  -- rechazar
```

- El último argumento (últimos 4 dígitos) es opcional: si la cuenta cambió entre el aviso y la revisión, la
  función se niega en vez de verificar otra cuenta.
- Al rechazar, el motivo lo ve el productor en Configuración > Datos para pagos y en `get_verification_status`.
  Cuando guarda datos corregidos, el rechazo se borra solo y llega un aviso nuevo.
- Aprobar no salta la espera de 72 h tras un cambio de datos (la respuesta trae `payouts_enabled_from`).

## Pagar un retiro (aviso "💸 Retiro solicitado")

1. Ver los datos para transferir (el aviso trae la consulta):
   `select bank_name, bank_account_type, bank_account_number, bank_account_holder, bank_account_rut from organization_payout_accounts where organization_id = 57;`
2. Transferir desde el banco.
3. Registrar el pago con el n° de comprobante (lo ve el productor):

```sql
select aitickets_set_payout_status('<payout_id>', 'processing', null, null, 'seba');          -- opcional: "en proceso"
select aitickets_set_payout_status('<payout_id>', 'paid', 'TRX-123456', null, 'seba');        -- pagado
select aitickets_set_payout_status('<payout_id>', 'failed', null, 'Cuenta cerrada', 'seba');  -- no se pudo: el monto vuelve al saldo
```

`paid` se niega si la cuenta no está verificada, si cambió después de pedir el retiro o si sus últimos 4 dígitos
no son los del retiro. Si ya transferiste a la cuenta correcta igual, agrega `p_force => true`:
`select aitickets_set_payout_status('<payout_id>', 'paid', 'TRX-1', null, 'seba', true);`

El reparto por evento (`event_withdrawals`) ya no guarda el número de cuenta completo, el titular ni el RUT: solo
`•••• 6789`, `A** P****`, `••••678-9`. Los datos para transferir salen siempre de `organization_payout_accounts`.

## Cerrar un reembolso (aviso "💸 Reembolso solicitado" o "🛑 Evento cancelado")

1. Devolver el monto en el panel de Flow (buscar la orden por `payment_external_id`).
2. Registrar:

```sql
select aitickets_set_refund_status('<refund_id>', 'completed', '<id del reembolso en Flow>', null, 'seba');
select aitickets_set_refund_status('<refund_id>', 'failed', null, 'Tarjeta cancelada', 'seba');
```

- `failed` deja de descontar el monto del saldo del productor y permite volver a reembolsar, pero **no** revive las
  entradas ni devuelve la orden a pagada: hay que coordinar la devolución por otra vía.
- Para un evento cancelado, el aviso trae la consulta que lista todos sus reembolsos pendientes.
