import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { buildMessagesWithContext } from './utils/buildMessagesWithContext.js';
import { extractEventContextFromMessages, buildSystemPrompt } from './utils/extractEventContext.js';
import tools from './utils/tools.json' assert { type: 'json' };

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function sendMessageToProducer(eventId, message, userName, userEmail) {
  console.log("📨 Enviando mensaje a la productora:", { eventId, message, userName, userEmail });

  const { data, error } = await supabase
    .from("questions")
    .insert([{ event_id: eventId, question: message, user_name: userName, user_email: userEmail }]);

  if (error) {
    console.error("❌ Error insertando en Supabase:", error);
  } else {
    console.log("✅ Pregunta guardada en Supabase:", data);
  }
}

export const handler = async (event) => {
  const headers = event.headers || {};
  const secret = headers['x-api-secret'] || headers['X-API-SECRET'];

  if (secret !== process.env.API_SECRET) {
    return {
      statusCode: 401,
      body: JSON.stringify({ message: "Unauthorized" })
    };
  }

  if (event.requestContext.http.method !== "POST") {
    return {
      statusCode: 405,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Método no permitido" })
    };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { messages } = body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "No se enviaron mensajes válidos." })
      };
    }

    const eventContext = extractEventContextFromMessages(messages);
    const fullSystemPrompt = buildSystemPrompt(
      "Eres el asistente virtual de AI Tickets, una plataforma avanzada de venta de entradas para eventos de Tecnología e IA. Tu función es ayudar a los usuarios a seleccionar y comprar entradas rápidamente, completar formularios y enviar preguntas a la productora.",
      eventContext
    );

    const messagesToSend = buildMessagesWithContext(messages, {
      maxMessages: 8,
      systemPrompt: fullSystemPrompt,
      enableSummary: true
    });

    const response = await openai.chat.completions.create({
      model: "gpt-4-turbo",
      messages: messagesToSend,
      temperature: 0.7,
      tools,
      tool_choice: "auto"
    });

    console.log("🧠 Respuesta de OpenAI:", JSON.stringify(response.choices[0], null, 2));

    const choice = response.choices[0];

    if (choice?.message?.tool_calls?.length > 0) {
      const toolCalls = choice.message.tool_calls;
      const toolResponses = [];

      for (const toolCall of toolCalls) {
        const args = JSON.parse(toolCall.function.arguments || '{}');

        if (toolCall.function.name === "send_message_to_producer") {
          if (!args.event_id || !args.message || !args.user_name || !args.user_email) {
            return {
              statusCode: 200,
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ message: "No se pudieron interpretar los datos para la productora." })
            };
          }

          await sendMessageToProducer(args.event_id, args.message, args.user_name, args.user_email);

          toolResponses.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: "✅ Tu pregunta fue enviada correctamente a la productora."
          });

        } else if (
          toolCall.function.name === "fill_buyer_information"
        ) {
          // 👉 Para el front: enviar instrucciones de UI
          return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              message: null,
              function_calling: {
                called: true,
                name: toolCall.function.name,
                properties: args
              }
            })
          };
        }
      }

      // Si solo se ejecutó send_message_to_producer, hacemos la segunda llamada
      const secondResponse = await openai.chat.completions.create({
        model: "gpt-4-turbo",
        messages: [...messagesToSend, choice.message, ...toolResponses],
        temperature: 0.7
      });

      const finalContent = secondResponse.choices?.[0]?.message?.content?.trim();

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: finalContent || "✅ Tu pregunta ha sido enviada a la productora."
        })
      };
    }

    if (choice?.message?.content?.trim()) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: choice.message.content.trim() })
      };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "⚠️ La IA no respondió con contenido útil." })
    };

  } catch (error) {
    console.error("❌ Error general:", error);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Error en el procesamiento", error: error.message })
    };
  }
};
