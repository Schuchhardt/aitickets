import React from 'react'
import { Html } from '@react-email/html'
import { Head, Container, Section, Text, Heading, Img } from '@react-email/components'

export default function WelcomeEmail({ name }) {
  return (
    <Html lang="es">
      <Head>
        <style>
          {`
            @import url('https://fonts.googleapis.com/css2?family=Prompt:wght@400;600&family=Unbounded:wght@600&display=swap');
            * {
              font-family: 'Prompt', sans-serif;
              color: #1f1f1f;
              margin: 0;
              padding: 0;
            }
            h1, h2, h3 {
              font-family: 'Unbounded', sans-serif;
              font-weight: 600;
            }
            a {
              color: #111;
              text-decoration: underline;
            }
          `}
        </style>
      </Head>

      <Section style={{ backgroundColor: '#ffffff', padding: '32px 20px' }}>
        <Container style={{ maxWidth: '600px', margin: '0 auto' }}>
          <Img
            src="https://admin.aitickets.cl/logo-dark.png"
            alt="AITickets logo"
            width="140"
            style={{ margin: '0 auto 32px', display: 'block' }}
          />

          <Heading style={{ fontSize: '22px', marginBottom: '20px' }}>
            Hola {name},
          </Heading>

          <Text style={{ marginBottom: '16px' }}>
            ¡Bienvenido a <strong>AI Tickets</strong>, donde tus eventos encuentran a su público ideal! 🎟️
          </Text>

          <Text style={{ marginBottom: '16px' }}>
            Estamos emocionados de tenerte como parte de nuestra comunidad de productores que buscan vender más entradas, automatizar su promoción y conectar realmente con su audiencia.
          </Text>

          <Text style={{ fontWeight: '600', margin: '24px 0 8px' }}>¿Qué puedes hacer desde hoy?</Text>
          <Text>✅ Publica tu primer evento en minutos.</Text>
          <Text>✅ Automatiza tu promoción con IA.</Text>
          <Text>✅ Controla ventas, equipo, devoluciones y validación QR.</Text>

          <Text style={{ marginTop: '24px' }}>
            Pero eso no es todo. En AI Tickets creemos que el éxito de un evento no es solo vender entradas, sino construir una comunidad fiel que espere tu próxima producción.
          </Text>

          <Text style={{ fontWeight: '600', margin: '24px 0 8px' }}>🚀 Próximos pasos:</Text>
          <Text>1. Ingresa al panel: <a href="https://admin.aitickets.cl/login">admin.aitickets.cl</a></Text>
          <Text>2. Configura tu primer evento.</Text>
          <Text>3. Comparte tu link y empieza a vender.</Text>

          <Text style={{ marginTop: '24px' }}>
            ¿Tienes dudas? Escríbenos a <a href="mailto:soporte@aitickets.com">soporte@aitickets.com</a>. Nuestro equipo está listo para ayudarte.
          </Text>

          <Text style={{ marginTop: '24px' }}>
            Gracias por confiar en AI Tickets.<br />
            ¡Estamos aquí para que tus eventos sean un éxito!
          </Text>

          <Text style={{ marginTop: '16px', fontStyle: 'italic' }}>
            — El equipo de AI Tickets<br />
            "Donde la comunidad encuentra su evento ideal"
          </Text>
        </Container>
      </Section>
    </Html>
  )
}


