/**
 * Composable para Google Analytics
 * Proporciona funciones para rastrear eventos personalizados.
 *
 * Layout.astro define `window.gtag` y `window.dataLayer` en el hilo principal
 * (Partytown los reenvía al worker donde corre gtag.js), así que estas
 * funciones se pueden llamar desde cualquier componente del cliente.
 *
 * Uso:
 *   import { trackPurchase } from '../composables/useGoogleAnalytics.js';
 *   // o
 *   const { trackPurchase } = useGoogleAnalytics();
 */

/**
 * Función genérica para enviar eventos a Google Analytics.
 * Nunca lanza errores (la analítica no debe romper la app).
 * @param {string} eventName - Nombre del evento
 * @param {Object} parameters - Parámetros adicionales del evento
 */
export const trackEvent = (eventName, parameters = {}) => {
  if (typeof window === 'undefined') return;
  try {
    if (typeof window.gtag !== 'function') {
      // Mismo stub que Layout.astro (por si la página no usa el Layout)
      window.dataLayer = window.dataLayer || [];
      window.gtag = function () { window.dataLayer.push(arguments); };
    }
    window.gtag('event', eventName, parameters);
  } catch (err) {
    console.warn('[analytics] No se pudo enviar el evento', eventName, err);
  }
};

const safeUnitPrice = (total, quantity) => {
  const q = Number(quantity) || 0;
  return q > 0 ? Number(total || 0) / q : Number(total || 0);
};

/**
 * view_item: alguien ve la página de un evento.
 */
export const trackViewItem = (eventId, eventName, price = 0) => {
  trackEvent('view_item', {
    currency: 'CLP',
    value: Number(price) || 0,
    items: [{
      item_id: String(eventId ?? ''),
      item_name: eventName || '',
      item_category: 'event_ticket',
      price: Number(price) || 0,
    }],
  });
};

/**
 * begin_checkout: el comprador inicia el pago.
 */
export const trackBeginCheckout = (eventId, eventName, quantity, totalPrice) => {
  trackEvent('begin_checkout', {
    currency: 'CLP',
    value: Number(totalPrice) || 0,
    items: [{
      item_id: String(eventId ?? ''),
      item_name: eventName || '',
      item_category: 'event_ticket',
      quantity: Number(quantity) || 0,
      price: safeUnitPrice(totalPrice, quantity),
    }],
  });
};

/**
 * purchase: compra completada (conversión principal).
 */
export const trackPurchase = (transactionId, eventId, eventName, quantity, totalPrice) => {
  trackEvent('purchase', {
    transaction_id: String(transactionId ?? ''),
    currency: 'CLP',
    value: Number(totalPrice) || 0,
    items: [{
      item_id: String(eventId ?? ''),
      item_name: eventName || '',
      item_category: 'event_ticket',
      quantity: Number(quantity) || 0,
      price: safeUnitPrice(totalPrice, quantity),
    }],
  });
};

/**
 * sign_up: registro de un productor.
 */
export const trackSignUp = (method = 'email', params = {}) => {
  trackEvent('sign_up', { method, ...params });
};

export const useGoogleAnalytics = () => {




  /**
   * Rastrea cuando un usuario agrega una entrada al carrito/selección
   * @param {string} eventId - ID del evento
   * @param {string} eventName - Nombre del evento
   * @param {number} quantity - Cantidad de entradas
   * @param {number} price - Precio por entrada
   */
  const trackAddToCart = (eventId, eventName, quantity, price) => {
    trackEvent('add_to_cart', {
      currency: 'CLP',
      value: price * quantity,
      items: [{
        item_id: eventId,
        item_name: eventName,
        item_category: 'event_ticket',
        quantity: quantity,
        price: price
      }]
    });
  };

  /**
   * Rastrea cuando un usuario comparte un evento
   * @param {string} eventId - ID del evento
   * @param {string} method - Método de compartir (facebook, twitter, etc.)
   */
  const trackShare = (eventId, method) => {
    trackEvent('share', {
      method: method,
      content_type: 'event',
      item_id: eventId
    });
  };


  /**
   * Rastrea cuando se usa el asistente de IA
   * @param {string} eventId - ID del evento
   * @param {string} question - Pregunta realizada (opcional, solo palabras clave)
   */
  const trackAIAssistant = (eventId, question = '') => {
    trackEvent('ai_assistant_used', {
      event_id: eventId,
      question_type: question.slice(0, 50) // Limitar para privacidad
    });
  };

  /**
   * Rastrea cuando se valida un ticket QR
   * @param {string} eventId - ID del evento
   * @param {boolean} isValid - Si el ticket es válido
   */
  const trackTicketValidation = (eventId, isValid) => {
    trackEvent('ticket_validation', {
      event_id: eventId,
      validation_result: isValid ? 'valid' : 'invalid'
    });
  };

  /**
   * Alias histórico de trackViewItem
   */
  const trackViewEvent = (eventId, eventName, price) => trackViewItem(eventId, eventName, price);

  return {
    trackEvent,
    trackViewItem,
    trackViewEvent,
    trackBeginCheckout,
    trackPurchase,
    trackAddToCart,
    trackShare,
    trackSignUp,
    trackAIAssistant,
    trackTicketValidation
  };
};