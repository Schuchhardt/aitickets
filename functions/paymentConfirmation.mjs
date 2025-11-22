import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import fetch from 'node-fetch';

// Simple logger utility for better error tracking
const logger = {
  info: (message, data = {}) => {
    console.log(`[INFO] ${message}`, JSON.stringify(data, null, 2));
  },
  error: (message, error = {}) => {
    console.error(`[ERROR] ${message}`, {
      message: error.message,
      stack: error.stack,
      ...error
    });
  },
  warn: (message, data = {}) => {
    console.warn(`[WARN] ${message}`, JSON.stringify(data, null, 2));
  }
};

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const flowApiKey = process.env.FLOW_API_KEY;
const flowApiSecret = process.env.FLOW_SECRET_KEY;
const flowApiUrl = process.env.FLOW_BASE_URL + '/payment/getStatus';

function generateSignature(params, secretKey) {
  const keys = Object.keys(params).filter(key => key !== 's').sort();
  const stringToSign = keys.map(key => key + params[key]).join('');
  return crypto.createHmac('sha256', secretKey).update(stringToSign).digest('hex');
}

export const handler = async (event) => {
  logger.info('🚀 [PaymentConfirmation] Iniciando procesamiento de confirmación de pago');
  logger.info('📧 [PaymentConfirmation] Event recibido', {
    method: event.requestContext.http.method,
    headers: event.headers,
    queryStringParameters: event.queryStringParameters,
    bodyLength: event.body?.length || 0,
    isBase64Encoded: event.isBase64Encoded
  });

  if (event.requestContext.http.method !== 'POST') {
    logger.warn('❌ [PaymentConfirmation] Método no permitido', { method: event.requestContext.http.method });
    return {
      statusCode: 405,
      body: JSON.stringify({ message: 'Método no permitido' }),
    };
  }

  try {
    let token = event.queryStringParameters?.token;
    console.log('🔑 [PaymentConfirmation] Token inicial desde query params:', token);

    if (!token) {
      console.log('🔍 [PaymentConfirmation] Token no encontrado en query params, buscando en body');
      const contentType = event.headers['content-type'] || event.headers['Content-Type'];
      console.log('📝 [PaymentConfirmation] Content-Type:', contentType);
    
      const bodyString = event.isBase64Encoded
        ? Buffer.from(event.body, 'base64').toString('utf-8')
        : event.body;
      
      console.log('📄 [PaymentConfirmation] Body string:', bodyString);
    
      if (contentType && contentType.includes('application/x-www-form-urlencoded')) {
        const bodyParams = new URLSearchParams(bodyString);
        token = bodyParams.get('token');
        console.log('🔑 [PaymentConfirmation] Token extraído del body:', token);
        console.log('📋 [PaymentConfirmation] Todos los parámetros del body:', Array.from(bodyParams.entries()));
      } else {
        logger.warn('❌ [PaymentConfirmation] Content-Type no soportado', { contentType });
        return {
          statusCode: 400,
          body: JSON.stringify({ message: 'Tipo de contenido no soportado' }),
        };
      }
    }
    
    if (!token) {
      logger.error('❌ [PaymentConfirmation] Token no recibido después de todas las búsquedas');
      return {
        statusCode: 400,
        body: JSON.stringify({ message: 'Token no recibido' }),
      };
    }
    
    console.log('✅ [PaymentConfirmation] Token final obtenido:', token);

    const signature = generateSignature({ apiKey: flowApiKey, token }, flowApiSecret);
    console.log('🔏 [PaymentConfirmation] Signature generada:', signature);
    
    const url = `${flowApiUrl}?apiKey=${flowApiKey}&token=${token}&s=${signature}`;
    console.log('🔗 [PaymentConfirmation] URL para consultar Flow:', url);
    
    const flowResponse = await fetch(url, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
    console.log('📡 [PaymentConfirmation] Flow response status:', flowResponse.status);
    
    const paymentStatus = await flowResponse.json();
    console.log('💳 [PaymentConfirmation] Payment status desde Flow:', JSON.stringify(paymentStatus, null, 2));

    if (!flowResponse.ok) {
      logger.error('❌ [PaymentConfirmation] Error al consultar Flow', { 
        status: flowResponse.status, 
        paymentStatus,
        url 
      });
      return { statusCode: 500, body: JSON.stringify({ message: 'Error al consultar Flow', error: paymentStatus }) };
    }

    const { commerceOrder, status, amount, paymentData } = paymentStatus;
    console.log('📊 [PaymentConfirmation] Datos extraídos:', { commerceOrder, status, amount, paymentData });
    
    if (status !== 2) {
      console.log('⏳ [PaymentConfirmation] Pago no confirmado aún, status:', status);
      return { statusCode: 200, body: JSON.stringify({ message: 'Pago no confirmado aún', status }) };
    }
    
    console.log('✅ [PaymentConfirmation] Pago confirmado, procediendo con la orden:', commerceOrder);

    console.log('🔍 [PaymentConfirmation] Buscando orden en Supabase:', commerceOrder);
    const { data: orderData, error: orderError } = await supabase
      .from('event_orders')
      .select('event_id, attendee_id, ticket_details')
      .eq('id', commerceOrder)
      .maybeSingle();

    console.log('📋 [PaymentConfirmation] Resultado de búsqueda orden:', { orderData, orderError });

    if (orderError || !orderData) {
      logger.error('❌ [PaymentConfirmation] Error buscando orden', { 
        error: orderError?.message,
        commerceOrder,
        orderData 
      });
      return { statusCode: 500, body: JSON.stringify({ message: 'Error buscando orden', error: orderError?.message }) };
    }

    const { event_id, attendee_id, ticket_details } = orderData;
    console.log('📝 [PaymentConfirmation] Datos de la orden:', { event_id, attendee_id, ticket_details });

    const updateData = {
      status: 'paid',
      total_payment: amount,
      payment_fee: parseInt(paymentData.fee, 10) + parseInt(paymentData.taxes, 10),
      balance: paymentData.balance,
      payment_commerce_id: paymentData.media,
    };
    console.log('🔄 [PaymentConfirmation] Actualizando orden con datos:', updateData);

    const { error: updateError } = await supabase
      .from('event_orders')
      .update(updateData)
      .eq('id', commerceOrder);

    if (updateError) {
      logger.error('❌ [PaymentConfirmation] Error actualizando orden', { 
        error: updateError.message,
        updateData,
        commerceOrder 
      });
      return { statusCode: 500, body: JSON.stringify({ message: 'Error actualizando orden', error: updateError.message }) };
    }
    
    console.log('✅ [PaymentConfirmation] Orden actualizada correctamente');

    console.log('🎫 [PaymentConfirmation] Generando event_attendees para tickets:', ticket_details);
    const eventAttendees = [];
    ticket_details.forEach(ticket => {
      console.log(`🎟️ [PaymentConfirmation] Procesando ticket: ${ticket.name}, cantidad: ${ticket.quantity}`);
      for (let i = 0; i < ticket.quantity; i++) {
        const uniqueHash = crypto.createHash('sha256')
          .update(`${attendee_id}-${event_id}-${ticket.id}-${Date.now()}-${i}`)
          .digest('hex');

        const attendeeData = {
          event_id,
          event_ticket_id: parseInt(ticket.id, 10),
          attendee_id,
          qr_code: uniqueHash,
          is_complimentary: false,
          status: 'active',
          event_order_id: commerceOrder,
        };
        
        eventAttendees.push(attendeeData);
        console.log(`🎫 [PaymentConfirmation] Entrada ${i + 1} generada:`, attendeeData);
      }
    });

    console.log('📦 [PaymentConfirmation] Total de entradas a insertar:', eventAttendees.length);
    const { data: eventTickets, error: insertError } = await supabase.from('event_attendees').insert(eventAttendees);
    
    if (insertError) {
      logger.error('❌ [PaymentConfirmation] Error insertando entradas', { 
        error: insertError.message,
        eventAttendees: eventAttendees.length,
        commerceOrder 
      });
      return { statusCode: 500, body: JSON.stringify({ message: 'Error insertando entradas', error: insertError.message }) };
    }

    console.log('✅ [PaymentConfirmation] Entradas registradas exitosamente:', eventTickets);

    console.log('🎉 [PaymentConfirmation] Proceso completado exitosamente');
    return { statusCode: 200, body: JSON.stringify({ message: 'Pago confirmado y entradas registradas' }) };

  } catch (error) {
    logger.error('💥 [PaymentConfirmation] Error crítico', error);
    return { statusCode: 500, body: JSON.stringify({ message: 'Error interno', error: error.message }) };
  }
};
