import React from 'react'
import { Html } from '@react-email/html'
import {
  Heading,
  Text,
  Container,
  Section,
  Img,
  Hr,
  Link
} from '@react-email/components'

export default function TicketEmail({ name, eventName, eventDate, location, ticketLink, total, ticketType, quantity }) {
  return (
    <Html lang="es">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Prompt:wght@400;600&family=Unbounded:wght@600&display=swap"
          rel="stylesheet"
        />
        <style>
          {`
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
      </head>

      <Section style={{ backgroundColor: '#ffffff', padding: '32px 20px' }}>
        <Container style={{ maxWidth: '600px', margin: '0 auto' }}>
          <Img
            src="https://admin.aitickets.cl/logo-dark.png"
            width="140"
            alt="AITickets logo"
            style={{ display: 'block', margin: '0 auto 32px' }}
          />

          <Heading style={{ fontSize: '22px', marginBottom: '20px' }}>Hola {name},</Heading>

          <Text style={{ fontSize: '14px', lineHeight: '24px', margin: '16px 0' }}>
            ¡Gracias por ser parte de la comunidad de <strong>AI Tickets</strong>! 🎉
            Tu compra fue exitosa y ya tienes tu entrada para:
          </Text>

          <Text style={{ fontSize: '14px', lineHeight: '24px', margin: '16px 0' }}>
            🎶 <strong>{eventName}</strong><br />
            📍 {location}<br />
            📅 {eventDate}
          </Text>

          <Text style={{ fontSize: '14px', lineHeight: '24px', margin: '16px 0' }}>
            Acá en este link puedes ver tu entrada con código QR para que solo tengas que mostrarla desde tu celular al llegar. Así de fácil:
          </Text>

          <Text style={{ fontSize: '14px', lineHeight: '24px', margin: '16px 0' }}>
            📥 <Link href={ticketLink}>Ver Entrada</Link>
          </Text>

          <Hr style={{ margin: '24px 0' }} />

          <Heading as="h2" style={{ fontSize: '18px', margin: '8px 0' }}>ℹ️ Detalles de tu compra:</Heading>

          <Text style={{ fontSize: '14px', lineHeight: '24px', margin: '8px 0' }}>Evento: {eventName}</Text>
          <Text style={{ fontSize: '14px', lineHeight: '24px', margin: '8px 0' }}>Entradas: {quantity}</Text>
          <Text style={{ fontSize: '14px', lineHeight: '24px', margin: '8px 0' }}>Tipo de entrada: {ticketType}</Text>
          <Text style={{ fontSize: '14px', lineHeight: '24px', margin: '8px 0' }}>Total pagado: {total}</Text>

          <Hr style={{ margin: '24px 0' }} />

          <Text style={{ fontSize: '14px', lineHeight: '24px', margin: '16px 0' }}>
            🚨 Recuerda:<br />
            - Llega con tiempo para evitar filas.<br />
            - Ten tu QR a mano (puedes mostrarlo desde tu email o descargarlo).
          </Text>

          <Text style={{ fontSize: '14px', lineHeight: '24px', margin: '16px 0' }}>
            Si tienes dudas, contáctanos a <Link href="mailto:soporte@aitickets.com">soporte@aitickets.com</Link>.
          </Text>

          <Text style={{ fontSize: '14px', lineHeight: '24px', margin: '16px 0' }}>
            ✨ Sorpresa: Después del evento, cuéntanos cómo fue tu experiencia. ¡Cada opinión suma puntos que podrás usar en futuras entradas y beneficios exclusivos!
          </Text>

          <Text style={{ fontSize: '14px', lineHeight: '24px', margin: '16px 0' }}>
            Gracias por confiar en AI Tickets.<br />
            ¡Nos encanta acercarte a los eventos que te gustan!
          </Text>

          <Text style={{ fontSize: '14px', lineHeight: '24px', marginTop: '16px', fontStyle: 'italic' }}>
            — El equipo de AI Tickets<br />
            "Donde la comunidad encuentra su evento ideal"
          </Text>
        </Container>
      </Section>
    </Html>
  )
}
