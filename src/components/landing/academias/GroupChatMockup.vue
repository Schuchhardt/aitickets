<script setup>
// Chat del "Antes" en el comparador de academias (SPEC_landing_academias §3.3 y §0.5): un grupo de apoderados genérico,
// sin logo ni colores de WhatsApp. Con movimiento, los mensajes aparecen uno a uno (AC5, 260 ms entre cada uno) cuando
// `played` pasa a true; sin movimiento se ven todos desde el principio. En mobile se esconden los `desktopOnly` (§3.10).
const props = defineProps({
  chat: { type: Object, required: true }, // { title, members, unread, messages: [{ name, text, mine?, desktopOnly? }] }
  played: { type: Boolean, required: true },
  animated: { type: Boolean, required: true },
})

const initials = (title) =>
  title
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
</script>

<template>
  <div class="gc" :class="{ 'is-animated': props.animated, 'is-played': props.played }">
    <div class="gc-head">
      <span class="gc-avatar" aria-hidden="true">{{ initials(props.chat.title) }}</span>
      <p class="gc-title">
        <span class="gc-name">{{ props.chat.title }}</span>
        <span class="gc-members">{{ props.chat.members }} participantes</span>
      </p>
      <span class="gc-unread">+{{ props.chat.unread }}<span class="lp-sr-only"> mensajes sin leer</span></span>
    </div>
    <ul class="gc-messages">
      <li
        v-for="(m, i) in props.chat.messages"
        :key="i"
        class="gc-msg"
        :class="{ 'is-mine': m.mine, 'is-desktop': m.desktopOnly }"
        :style="{ '--gc-d': `${200 + i * 260}ms` }"
      >
        <span class="gc-from">{{ m.name }}</span>
        {{ m.text }}
      </li>
    </ul>
    <div class="gc-note" aria-hidden="true">
      <p class="gc-note-title">Planilla.xlsx</p>
      <p>¿Pagó? ¿Cuántas? ¿Retiró?</p>
      <p class="gc-note-meta">87 filas</p>
    </div>
  </div>
</template>

<style scoped>
.gc {
  position: relative;
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px;
  border-radius: 22px;
  background: var(--ac-chat-bg);
  overflow: hidden;
}
.gc-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid rgba(27, 23, 18, 0.1);
}
.gc-avatar {
  width: 36px;
  height: 36px;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: #c9b79e;
  font-family: "Unbounded", system-ui, sans-serif;
  font-size: 11px;
  font-weight: 700;
}
.gc-title {
  flex: 1;
  min-width: 0;
}
.gc-name {
  display: block;
  font-size: 14px;
  font-weight: 600;
}
.gc-members {
  display: block;
  font-size: 12px;
  color: var(--ac-text-4);
}
.gc-unread {
  padding: 3px 9px;
  border-radius: 999px;
  background: var(--ac-chaos);
  color: #fff;
  font-size: 12px;
  font-weight: 600;
}
.gc-messages {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.gc-msg {
  align-self: flex-start;
  max-width: 85%;
  padding: 8px 10px;
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 1px 1px rgba(27, 23, 18, 0.06);
  font-size: 13px;
  line-height: 19px;
}
.gc-msg.is-mine {
  align-self: flex-end;
  background: var(--ac-chat-mine);
}
.gc-msg.is-desktop {
  display: none;
}
.gc-from {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: var(--ac-serif);
}
.gc-msg.is-mine .gc-from {
  color: #3b6e00;
}
.gc-note {
  display: none;
}
/* AC5: con movimiento, los mensajes esperan a que la sección entre y aparecen en secuencia */
.gc.is-animated .gc-msg {
  opacity: 0;
}
.gc.is-animated.is-played .gc-msg {
  animation: gc-bubble 380ms var(--ease-out) var(--gc-d) both;
}
@keyframes gc-bubble {
  from {
    opacity: 0;
    transform: translateY(10px) scale(0.97);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
@media (min-width: 768px) {
  .gc {
    gap: 10px;
    padding: 22px;
    border-radius: 28px;
  }
  .gc-head {
    padding-bottom: 12px;
  }
  .gc-avatar {
    width: 40px;
    height: 40px;
    font-size: 13px;
  }
  .gc-name {
    font-size: 15px;
  }
  .gc-messages {
    gap: 10px;
  }
  .gc-msg {
    max-width: 78%;
    padding: 9px 12px;
    border-radius: 16px;
    font-size: 14px;
    line-height: 20px;
  }
  .gc-msg.is-desktop {
    display: block;
  }
  .gc-note {
    display: block;
    position: absolute;
    right: 18px;
    bottom: 36px;
    width: 170px;
    padding: 12px 14px;
    border-radius: 6px;
    background: #fff6a8;
    box-shadow: 0 10px 24px rgba(27, 23, 18, 0.15);
    font-size: 13px;
    line-height: 19px;
    transform: rotate(4deg);
  }
  .gc-note-title {
    font-weight: 600;
  }
  .gc-note-meta {
    color: var(--ac-text-4);
  }
}
@media (prefers-reduced-motion: reduce) {
  .gc.is-animated .gc-msg {
    opacity: 1;
    animation: none;
  }
}
</style>
