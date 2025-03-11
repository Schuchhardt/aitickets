import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function sendMessageToProducer(eventId, message, userName, userEmail) {
  console.log("Enviando mensaje a la productora:", { eventId, message });

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
  const secret = headers['x-api-secret'];

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
    const body = JSON.parse(event.body);
    const { messages } = body;

    const formattedMessages = messages
      .filter(msg => msg.text?.trim())
      .map(msg => ({
        role: msg.role,
        content: msg.text
      }));

    const tools = [
      {
        type: "function",
        function: {
          name: "update_ticket_selection",
          description: "Modifica la selección de entradas del usuario en la UI.",
          parameters: {
            type: "object",
            properties: {
              ticket_type_id: { type: "string", description: "El ID del tipo de entrada seleccionada." },
              quantity: { type: "integer", description: "Cantidad de entradas seleccionadas." }
            },
            required: ["ticket_type_id", "quantity"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "fill_buyer_information",
          description: "Prellena el formulario de compra con la información del usuario.",
          parameters: {
            type: "object",
            properties: {
              first_name: { type: "string", description: "Nombre del comprador." },
              last_name: { type: "string", description: "Apellido del comprador." },
              email: { type: "string", description: "Correo electrónico del comprador." },
              phone: { type: "string", description: "Número de teléfono del comprador." }
            },
            required: ["first_name", "last_name", "email", "phone"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "send_message_to_producer",
          description: "Envía un mensaje a la productora del evento para responder dudas de los usuarios.",
          parameters: {
            type: "object",
            properties: {
              event_id: { type: "integer", description: "ID del evento" },
              message: { type: "string", description: "Mensaje del usuario" },
              user_name: { type: "string", description: "Nombre del usuario" },
              user_email: { type: "string", description: "Email del usuario" }
            },
            required: ["event_id", "message", "user_name", "user_email"]
          }
        }
      }
    ];

    const response = await openai.chat.completions.create({
      model: "gpt-4-turbo",
      messages: [
        {
          role: "system",
          content: `Eres el asistente virtual de AI Tickets...` // mismo mensaje original aquí
        },
        ...formattedMessages,
      ],
      temperature: 0.7,
      tools,
      tool_choice: "auto",
    });

    if (response.choices[0]?.message?.tool_calls) {
      for (const toolCall of response.choices[0].message.tool_calls) {
        if (toolCall.function.name === "send_message_to_producer") {
          const { event_id, message, user_name, user_email } = JSON.parse(toolCall.function.arguments);
          await sendMessageToProducer(event_id, message, user_name, user_email);
          return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: "✅ Tu pregunta ha sido enviada a la productora." })
          };
        }
      }
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: response.choices[0]?.message?.content || "Sin respuesta" })
    };

  } catch (error) {
    console.error("❌ Error general:", error);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Error en la IA", error: error.message })
    };
  }
};
