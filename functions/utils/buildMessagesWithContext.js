export function buildMessagesWithContext(userMessages = [], options = {}) {
  const {
    maxMessages = 8,
    systemPrompt = "Eres el asistente virtual de AI Tickets, una plataforma avanzada de venta de entradas para eventos de Tecnología e IA.",
    enableSummary = true,
    maxSummaryMessages = 10
  } = options;

  const cleanedMessages = userMessages
    .filter(m => m?.text?.trim())
    .map(m => ({ role: m.role, content: m.text.trim() }));

  const recentMessages = cleanedMessages.slice(-maxMessages);
  const olderMessages = cleanedMessages.slice(0, -maxMessages);

  let summaryBlock = [];
  if (enableSummary && olderMessages.length > 0) {
    const summaryText = olderMessages
      .slice(-maxSummaryMessages)
      .map(m => `- ${m.role}: ${m.content}`)
      .join('\n');

    summaryBlock = [{
      role: "user",
      content: `Resumen de la conversación anterior:\n${summaryText}`
    }];
  }

  const finalMessages = [
    { role: "system", content: systemPrompt },
    ...summaryBlock,
    ...recentMessages
  ];

  return finalMessages;
}