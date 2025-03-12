export function extractEventContextFromMessages(messages = []) {
  const systemMessages = messages.filter(m => m.role === "system");
  if (systemMessages.length === 0) return '';

  const contextText = systemMessages.map(m => m.text || m.content).join('\n').trim();
  return contextText;
}

export function buildSystemPrompt(basePrompt, eventContext = '') {
  return `
${basePrompt}

${eventContext ? `\nContexto del evento actual:\n${eventContext}` : ''}
`.trim();
}