import { http, HttpResponse } from 'msw';

/**
 * Handlers de ejemplo para MSW
 * Agregar aquí los mocks de APIs necesarios para tests
 */
export const handlers = [
  // Ejemplo: Mock de endpoint de eventos
  http.get('/api/events', () => {
    return HttpResponse.json([
      {
        id: '1',
        title: 'Evento de Prueba',
        date: '2025-12-31',
        location: 'Madrid',
        price: 50,
      },
    ]);
  }),

  // Ejemplo: Mock de compra de tickets
  http.post('/api/purchase', async ({ request }) => {
    const body = await request.json() as { tickets: unknown[] };
    return HttpResponse.json({
      success: true,
      orderId: 'test-order-123',
      tickets: body.tickets,
    });
  }),

  // Ejemplo: Mock de validación de ticket
  http.post('/api/validate', async ({ request }) => {
    const body = await request.json() as { ticketId: string };
    return HttpResponse.json({
      valid: true,
      ticket: {
        id: body.ticketId,
        eventName: 'Evento de Prueba',
        used: false,
      },
    });
  }),
];
