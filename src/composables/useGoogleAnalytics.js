/**
 * Composable para Google Analytics
 * Proporciona funciones para rastrear eventos personalizados
 */

export const useGoogleAnalytics = () => {
  
  /**
   * Función genérica para enviar eventos a Google Analytics
   * @param {string} eventName - Nombre del evento
   * @param {Object} parameters - Parámetros adicionales del evento
   */
  const trackEvent = (eventName, parameters = {}) => {
    if (typeof window !== 'undefined' && window.gtag) {
      window.gtag('event', eventName, parameters);
    }
  };

  /**
   * Rastrea cuando un usuario ve un evento
   * @param {string} eventId - ID del evento
   * @param {string} eventName - Nombre del evento
   * @param {number} price - Precio de la entrada
   */
  const trackViewEvent = (eventId, eventName, price) => {
    trackEvent('view_item', {
      currency: 'CLP',
      value: price,
      item_id: eventId,
      item_name: eventName,
      item_category: 'event_ticket'
    });
  };

  /**
   * Rastrea cuando un usuario inicia el proceso de compra
   * @param {string} eventId - ID del evento
   * @param {string} eventName - Nombre del evento
   * @param {number} quantity - Cantidad de entradas
   * @param {number} totalPrice - Precio total
   */
  const trackBeginCheckout = (eventId, eventName, quantity, totalPrice) => {
    trackEvent('begin_checkout', {
      currency: 'CLP',
      value: totalPrice,
      items: [{
        item_id: eventId,
        item_name: eventName,
        item_category: 'event_ticket',
        quantity: quantity,
        price: totalPrice / quantity
      }]
    });
  };

  /**
   * Rastrea cuando se completa una compra (conversión principal)
   * @param {string} transactionId - ID de la transacción
   * @param {string} eventId - ID del evento
   * @param {string} eventName - Nombre del evento
   * @param {number} quantity - Cantidad de entradas
   * @param {number} totalPrice - Precio total
   */
  const trackPurchase = (transactionId, eventId, eventName, quantity, totalPrice) => {
    trackEvent('purchase', {
      transaction_id: transactionId,
      currency: 'CLP',
      value: totalPrice,
      items: [{
        item_id: eventId,
        item_name: eventName,
        item_category: 'event_ticket',
        quantity: quantity,
        price: totalPrice / quantity
      }]
    });
  };

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
   * Rastrea cuando un usuario se registra como productor
   * @param {string} method - Método de registro
   */
  const trackSignUp = (method = 'email') => {
    trackEvent('sign_up', {
      method: method
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

  return {
    trackEvent,
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