import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const supabaseUrl = process.env.PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Inserta un mensaje en la tabla `questions` de Supabase.
 */
async function sendMessageToProducer(eventId, message, userName, userEmail) {
  console.log("Enviando mensaje a la productora:", { eventId, message });

  const { data, error } = await supabase
    .from("questions")
    .insert([{ 
      event_id: eventId,
      question: message,
      user_name: userName, 
      user_email: userEmail  }]);

  if (error) {
    console.error("❌ Error insertando en Supabase:", error);
  } else {
    console.log("✅ Pregunta guardada en Supabase:", data);
  }
}

export default async function handler(req) {
  if (req.method !== "POST") {
    console.log("❌ Método no permitido:", req.method);
    return new Response(JSON.stringify({ message: "Método no permitido" }), { status: 405 });
  }

  try {
    const { messages } = await req.json();

    // Filtrar y formatear mensajes
    const formattedMessages = messages
      .filter(msg => msg.text?.trim())
      .map(msg => ({
        role: msg.role,
        content: msg.text
      }));

    const tools = [
        // {
        //   "type": "function",
        //   "function": {
        //     "name": "update_ticket_selection",
        //     "description": "Modifica la selección de entradas del usuario en la UI.",
        //     "parameters": {
        //       "type": "object",
        //       "properties": {
        //         "ticket_type_id": {
        //           "type": "string",
        //           "description": "El ID del tipo de entrada seleccionada."
        //         },
        //         "quantity": {
        //           "type": "integer",
        //           "description": "Cantidad de entradas seleccionadas."
        //         }
        //       },
        //       "required": ["ticket_type_id", "quantity"]
        //     }
        //   }
        // },
        // {
        //   "type": "function",
        //   "function": {
        //     "name": "fill_buyer_information",
        //     "description": "Prellena el formulario de compra con la información del usuario.",
        //     "parameters": {
        //       "type": "object",
        //       "properties": {
        //         "first_name": {
        //           "type": "string",
        //           "description": "Nombre del comprador."
        //         },
        //         "last_name": {
        //           "type": "string",
        //           "description": "Apellido del comprador."
        //         },
        //         "email": {
        //           "type": "string",
        //           "description": "Correo electrónico del comprador."
        //         },
        //         "phone": {
        //           "type": "string",
        //           "description": "Número de teléfono del comprador."
        //         }
        //       },
        //       "required": ["first_name", "last_name", "email", "phone"]
        //     }
        //   }
        // },
          {
            "type": "function",
            "function": {
              "name": "send_message_to_producer",
              "description": "Envía un mensaje a la productora del evento para responder dudas de los usuarios.",
              "parameters": {
                "type": "object",
                "properties": {
                  "event_id": {
                    "type": "integer",
                    "description": "ID del evento sobre el cual el usuario tiene preguntas."
                  },
                  "message": {
                    "type": "string",
                    "description": "Mensaje del usuario para la productora. Se aplicará un filtro para evitar contenido ofensivo."
                  },
                  "user_name": {
                    "type": "string",
                    "description": "Nombre del usuario que hace la consulta. Si no se tiene, hay que preguntarselo"
                  },
                  "user_email": {
                    "type": "string",
                    "description": "Correo electrónico del usuario que hace la consulta. Si no se tiene, hay que preguntarselo"
                  }
                },
                "required": ["event_id", "message", "user_name", "user_email"]
              }
            }
          }
    ]
    const response = await openai.chat.completions.create({
      model: "gpt-4-turbo",
      messages: [
        {
          role: "system",
          content: `
          Eres el asistente virtual de AI Tickets, una plataforma avanzada de venta de entradas para eventos de Tecnología e IA. 
          Tu función es ayudar a los usuarios a seleccionar y comprar entradas de manera rápida y eficiente, proporcionando información detallada sobre el evento y facilitando el proceso de compra mediante interacciones inteligentes.
          
          - Puedes modificar la interfaz del usuario seleccionando el tipo y cantidad de entradas.
          - Puedes autocompletar los datos del comprador.
          - Si el usuario tiene preguntas que no puedes responder, puedes enviar un mensaje a la productora del evento.
          - Algunas funciones serán ejecutadas desde el backend, mientras que otras serán ejecutadas desde el frontend.
          `
        },
        ...formattedMessages,
      ],
      temperature: 0.7,
      tools,
      tool_choice: "auto",
    });

    console.log("✅ Petición enviada a OpenAI con éxito. Procesando respuesta...");

    // Verificar si hay una tool_call en la respuesta
    if (response.choices[0]?.message?.tool_calls) {
      for (const toolCall of response.choices[0].message.tool_calls) {
        if (toolCall.function.name === "send_message_to_producer") {
          try {
            console.log("🔧 Tool call detectada:", toolCall);
            
            const { event_id, message, user_name, user_email } = JSON.parse(toolCall.function.arguments);
            
            console.log(`📨 Enviando mensaje a la productora: ${message} para el evento ${event_id}, usuario: ${user_name}, email: ${user_email}`);

            await sendMessageToProducer(event_id, message, user_name, user_email);

            return new Response(JSON.stringify({
              message: "✅ Tu pregunta ha sido enviada a la productora. Recibirás la respuesta en tu correo."
            }), { status: 200 });

          } catch (err) {
            console.error("❌ Error procesando tool call:", err);
            return new Response(JSON.stringify({ message: "Error procesando tool call" }), { status: 500 });
          }
        }
      }
    }

    // Responder con el mensaje de OpenAI si no hay tool_calls
    return new Response(JSON.stringify({ message: response.choices[0]?.message?.content || "Sin respuesta" }), { status: 200 });

  } catch (error) {
    console.error("Error en el handler:", error);
    return new Response(JSON.stringify({ message: "Error en la IA", error: error.message }), { status: 500 });
  }
}

export const config = { path: "/api/ai-assistant" };
