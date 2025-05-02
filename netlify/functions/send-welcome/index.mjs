import { Resend } from 'resend'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'
import WelcomeEmail from './WelcomeEmail.jsx'

const resend = new Resend(process.env.RESEND_API_KEY)

export default async function handler(req) {
  console.log('📨 [send-welcome] Llamada recibida')

  if (req.method !== 'POST') {
    console.log('⛔ [send-welcome] Método no permitido')
    return new Response(JSON.stringify({ message: 'Método no permitido' }), { status: 405 })
  }

  try {
    const body = await req.json()
    const { name, email } = body

    console.log('👤 [send-welcome] Datos recibidos:', name, email)

    const html = renderToStaticMarkup(React.createElement(WelcomeEmail, { name }))

    const text = `
Hola ${name},

¡Bienvenido a AI Tickets, donde tus eventos encuentran a su público ideal!

Estamos emocionados de tenerte como parte de nuestra comunidad de productores que buscan vender más entradas, automatizar su promoción y conectar realmente con su audiencia.

¿Qué puedes hacer desde hoy?
- Publica tu primer evento en minutos.
- Deja que la IA trabaje por ti: automatizamos tu promoción para que te concentres en producir, no en vender.
- Accede a herramientas de gestión: control de ventas, equipo, devoluciones y validación QR.

Pero eso no es todo. En AI Tickets creemos que el éxito de un evento no es solo vender entradas, sino crear una comunidad fiel que espere tu próxima producción.

🚀 Próximos pasos:
1. Ingresa a tu panel: https://admin.aitickets.cl/login
2. Configura tu primer evento.
3. Comparte tu link y comienza a vender.

¿Tienes dudas o quieres sacarle el máximo provecho a la plataforma?
Nuestro equipo está listo para ayudarte. Escríbenos cuando quieras a soporte@aitickets.com.

Gracias por confiar en AI Tickets.
¡Estamos aquí para que tus eventos sean un éxito!

Un abrazo,  
El equipo de AI Tickets  
"Donde la comunidad encuentra su evento ideal"
`.trim()

    const { error } = await resend.emails.send({
      from: 'AITickets <welcome@email.aitickets.cl>',
      to: email,
      subject: '🎉 ¡Bienvenido a AI Tickets! Tu comunidad te está esperando',
      html,
      text
    })

    if (error) {
      console.error('❌ [send-welcome] Error al enviar el correo:', error)
      throw new Error('Error al enviar el correo')
    }

    console.log('✅ [send-welcome] Correo enviado con éxito a:', email)

    return new Response(JSON.stringify({ message: 'Correo enviado con éxito' }), {
      status: 200
    })
  } catch (err) {
    console.error('🔥 [send-welcome] Error inesperado:', err.message)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500
    })
  }
}

export const config = {
  path: ['/api/send-welcome']
}


