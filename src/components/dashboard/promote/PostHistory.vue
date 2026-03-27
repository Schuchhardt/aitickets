<script setup>
import { ref, computed } from 'vue'
import { 
  Send, Clock, AlertCircle, CheckCircle, XCircle, FileText,
  Instagram, Facebook, Image, ListFilter, Eye
} from 'lucide-vue-next'

const props = defineProps({
  posts: { type: Array, default: () => [] },
})

const activeFilter = ref('all')

const filteredPosts = computed(() => {
  if (activeFilter.value === 'all') return props.posts
  return props.posts.filter(p => p.status === activeFilter.value)
})

const filters = [
  { id: 'all', label: 'Todos', icon: ListFilter },
  { id: 'published', label: 'Publicados', icon: CheckCircle },
  { id: 'scheduled', label: 'Programados', icon: Clock },
  { id: 'draft', label: 'Borradores', icon: FileText },
  { id: 'failed', label: 'Fallidos', icon: XCircle },
]

const statusConfig = {
  draft: { label: 'Borrador', class: 'bg-gray-100 text-gray-600' },
  scheduled: { label: 'Programado', class: 'bg-blue-100 text-blue-700' },
  published: { label: 'Publicado', class: 'bg-green-100 text-green-700' },
  failed: { label: 'Fallido', class: 'bg-red-100 text-red-700' },
}

const platformIcons = {
  instagram: Instagram,
  facebook: Facebook,
}

const getEventName = (post) => {
  return post.events?.title || post.events?.name || 'Evento'
}

const truncateContent = (content, maxLength = 100) => {
  if (!content || content.length <= maxLength) return content
  return content.substring(0, maxLength) + '...'
}

const retryPublish = async (postId) => {
  try {
    const res = await fetch('/api/promote/posts/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ postId }),
    })
    if (res.ok) {
      window.location.reload()
    } else {
      const data = await res.json()
      alert(data.message || 'Error al reintentar')
    }
  } catch (err) {
    alert('Error al reintentar publicación')
  }
}
</script>

<template>
  <div>
    <!-- Empty state -->
    <div v-if="posts.length === 0" class="bg-white rounded-xl shadow-sm border border-gray-100 p-12 text-center">
      <div class="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4 text-gray-400">
        <Send :size="32" />
      </div>
      <h3 class="text-xl font-bold mb-2">No tienes posts aún</h3>
      <p class="text-gray-500 mb-6">Crea tu primer post para promocionar tus eventos en redes sociales.</p>
      <a
        href="/dashboard/promote/create"
        class="inline-flex bg-black text-white px-6 py-3 rounded-lg hover:bg-gray-800 transition font-medium"
      >
        Crear Post
      </a>
    </div>

    <div v-else>
      <!-- Filters -->
      <div class="flex flex-wrap gap-2 mb-6">
        <button
          v-for="filter in filters"
          :key="filter.id"
          @click="activeFilter = filter.id"
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors border"
          :class="activeFilter === filter.id ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'"
        >
          <component :is="filter.icon" :size="14" />
          {{ filter.label }}
        </button>
      </div>

      <!-- Posts List -->
      <div class="space-y-3">
        <div
          v-for="post in filteredPosts"
          :key="post.id"
          class="bg-white rounded-xl shadow-sm border border-gray-100 p-4 hover:shadow-md transition"
        >
          <div class="flex gap-4">
            <!-- Thumbnail -->
            <div class="w-20 h-20 rounded-lg bg-gray-100 shrink-0 overflow-hidden">
              <img v-if="post.image_urls?.length > 0" :src="post.image_urls[0]" class="w-full h-full object-cover" />
              <div v-else class="w-full h-full flex items-center justify-center text-gray-300">
                <Image :size="24" />
              </div>
            </div>

            <!-- Content -->
            <div class="flex-1 min-w-0">
              <div class="flex items-start justify-between gap-2 mb-1">
                <div>
                  <p class="text-xs text-gray-400 mb-0.5">{{ getEventName(post) }}</p>
                  <p class="text-sm text-gray-800">{{ truncateContent(post.content) }}</p>
                </div>
                <span
                  class="shrink-0 px-2 py-0.5 text-xs font-medium rounded-full"
                  :class="statusConfig[post.status]?.class || 'bg-gray-100 text-gray-600'"
                >
                  {{ statusConfig[post.status]?.label || post.status }}
                </span>
              </div>

              <div class="flex items-center gap-3 mt-2">
                <!-- Platforms -->
                <div class="flex items-center gap-1">
                  <component
                    v-for="platform in (post.platforms || [])"
                    :key="platform"
                    :is="platformIcons[platform]"
                    :size="14"
                    class="text-gray-400"
                  />
                </div>

                <!-- Date -->
                <span class="text-xs text-gray-400">
                  {{ new Date(post.created_at).toLocaleDateString('es-CL') }}
                </span>

                <!-- Scheduled date -->
                <span v-if="post.status === 'scheduled' && post.scheduled_for" class="flex items-center gap-1 text-xs text-blue-500">
                  <Clock :size="12" />
                  {{ new Date(post.scheduled_for).toLocaleString('es-CL') }}
                </span>

                <!-- Retry button for failed posts -->
                <button
                  v-if="post.status === 'failed'"
                  @click="retryPublish(post.id)"
                  class="text-xs text-red-600 hover:text-red-700 font-medium"
                >
                  Reintentar
                </button>
              </div>

              <!-- Error message -->
              <p v-if="post.status === 'failed' && post.error_message" class="text-xs text-red-400 mt-1">
                {{ post.error_message }}
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- Empty filtered state -->
      <div v-if="filteredPosts.length === 0" class="text-center py-8 text-gray-400">
        <p class="text-sm">No hay posts con el filtro seleccionado.</p>
      </div>
    </div>
  </div>
</template>
