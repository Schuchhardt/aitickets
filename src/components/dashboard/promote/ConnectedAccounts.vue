<script setup>
import { ref } from 'vue'
import { Instagram, Facebook, Plus, Unplug, Loader2, CheckCircle } from 'lucide-vue-next'

const props = defineProps({
  accounts: { type: Array, default: () => [] },
})

const emit = defineEmits(['disconnect'])

const connecting = ref(null) // 'instagram' | 'facebook' | null

const platforms = [
  {
    id: 'instagram',
    name: 'Instagram',
    icon: Instagram,
    color: 'from-purple-500 to-pink-500',
    bgColor: 'bg-gradient-to-br from-purple-50 to-pink-50',
    borderColor: 'border-purple-200',
    textColor: 'text-purple-700',
  },
  {
    id: 'facebook',
    name: 'Facebook',
    icon: Facebook,
    color: 'from-blue-500 to-blue-600',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
    textColor: 'text-blue-700',
  },
]

const getAccountForPlatform = (platformId) => {
  return props.accounts.find(a => a.platform === platformId && a.status === 'active')
}

const handleConnect = async (platformId) => {
  connecting.value = platformId
  try {
    const res = await fetch('/api/promote/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform: platformId }),
    })

    const data = await res.json()
    if (res.ok && data.redirect_url) {
      window.location.href = data.redirect_url
    } else {
      alert(data.message || 'Error al conectar')
      connecting.value = null
    }
  } catch (e) {
    alert('Error al conectar con la plataforma')
    connecting.value = null
  }
}

const handleDisconnect = (accountId) => {
  if (confirm('¿Estás seguro de que quieres desconectar esta cuenta?')) {
    emit('disconnect', accountId)
  }
}
</script>

<template>
  <div>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div
        v-for="platform in platforms"
        :key="platform.id"
        class="bg-white rounded-xl shadow-sm border overflow-hidden"
        :class="getAccountForPlatform(platform.id) ? platform.borderColor : 'border-gray-100'"
      >
        <div class="p-6">
          <!-- Platform Header -->
          <div class="flex items-center justify-between mb-4">
            <div class="flex items-center gap-3">
              <div
                class="w-12 h-12 rounded-xl flex items-center justify-center text-white bg-gradient-to-br"
                :class="platform.color"
              >
                <component :is="platform.icon" :size="24" />
              </div>
              <div>
                <h3 class="font-bold text-lg">{{ platform.name }}</h3>
                <p v-if="getAccountForPlatform(platform.id)" class="text-sm text-green-600 flex items-center gap-1">
                  <CheckCircle :size="14" />
                  Conectado
                </p>
                <p v-else class="text-sm text-gray-400">No conectado</p>
              </div>
            </div>
          </div>

          <!-- Connected Account Info -->
          <div v-if="getAccountForPlatform(platform.id)" class="mb-4">
            <div class="flex items-center gap-3 p-3 rounded-lg" :class="platform.bgColor">
              <img
                v-if="getAccountForPlatform(platform.id).avatar_url"
                :src="getAccountForPlatform(platform.id).avatar_url"
                class="w-10 h-10 rounded-full object-cover"
                :alt="getAccountForPlatform(platform.id).account_name"
              />
              <div v-else class="w-10 h-10 rounded-full flex items-center justify-center text-white bg-gradient-to-br" :class="platform.color">
                <component :is="platform.icon" :size="18" />
              </div>
              <div>
                <p class="font-medium text-sm" :class="platform.textColor">
                  @{{ getAccountForPlatform(platform.id).account_name || 'Cuenta conectada' }}
                </p>
                <p class="text-xs text-gray-400">
                  Conectado el {{ new Date(getAccountForPlatform(platform.id).created_at).toLocaleDateString('es-CL') }}
                </p>
              </div>
            </div>
          </div>

          <!-- Action Buttons -->
          <div v-if="getAccountForPlatform(platform.id)">
            <button
              @click="handleDisconnect(getAccountForPlatform(platform.id).id)"
              class="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition"
            >
              <Unplug :size="16" />
              Desconectar
            </button>
          </div>
          <div v-else>
            <button
              @click="handleConnect(platform.id)"
              :disabled="connecting === platform.id"
              class="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white rounded-lg transition bg-gradient-to-r disabled:opacity-50"
              :class="platform.color"
            >
              <Loader2 v-if="connecting === platform.id" :size="16" class="animate-spin" />
              <Plus v-else :size="16" />
              {{ connecting === platform.id ? 'Conectando...' : `Conectar ${platform.name}` }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Help text -->
    <div class="mt-6 p-4 bg-gray-50 rounded-xl border border-gray-100">
      <p class="text-sm text-gray-500">
        <strong class="text-gray-700">¿Cómo funciona?</strong> Conecta tus cuentas de redes sociales para publicar contenido promocional de tus eventos directamente desde aquí. Usa nuestra IA para generar textos e imágenes atractivas automáticamente.
      </p>
    </div>
  </div>
</template>
