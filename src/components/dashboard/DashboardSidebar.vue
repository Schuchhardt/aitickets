<script setup>
import { 
  LayoutDashboard, 
  CalendarDays, 
  Users, 
  Ticket,
  DollarSign,
  UserCog,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight
} from 'lucide-vue-next'
import { ref, toRefs } from 'vue'
import { supabase } from '../../lib/supabaseClient'
import logoLight from '../../images/logo.png'
import logoSquared from '../../images/logo_squared.png'

const props = defineProps(['userJson'])
const user = ref(props.userJson ? JSON.parse(props.userJson) : null)
const isCollapsed = ref(false)
const currentPath = ref(window.location.pathname)

const toggleCollapse = () => {
  isCollapsed.value = !isCollapsed.value
}

const handleLogout = async () => {
  await supabase.auth.signOut()
  window.location.href = '/organizadores/login'
}

const menuItems = [
  { name: 'Resumen', path: '/dashboard', icon: LayoutDashboard },
  { name: 'Mis Eventos', path: '/dashboard/events', icon: CalendarDays },
  { name: 'Entradas', path: '/dashboard/tickets', icon: Ticket },
  { name: 'Comunidad', path: '/dashboard/community', icon: Users },
  { name: 'Ingresos', path: '/dashboard/finance', icon: DollarSign },
  { name: 'Equipo', path: '/dashboard/team', icon: UserCog },
  { name: 'Configuración', path: '/dashboard/settings', icon: Settings },
]
</script>

<template>
  <aside 
    class="bg-white border-r border-gray-200 h-screen sticky top-0 flex flex-col transition-all duration-300 z-50"
    :class="isCollapsed ? 'w-20' : 'w-64'"
  >
    <!-- Header -->
    <div class="p-4 flex items-center justify-center border-b border-gray-100 h-16">
      <div v-if="!isCollapsed" class="flex items-center justify-center gap-2 overflow-hidden w-full">
        <img :src="logoLight.src" alt="AI Tickets" class="h-8" />
      </div>
      <img v-else :src="logoSquared.src" alt="AI Tickets" class="h-8" />
    </div>

    <!-- Navigation -->
    <nav class="flex-1 py-6 px-3 space-y-2">
      <a 
        v-for="item in menuItems" 
        :key="item.path"
        :href="item.path"
        class="flex items-center gap-3 px-3 py-3 rounded-lg transition-colors group relative"
        :class="[
          currentPath === item.path 
            ? 'bg-black text-white' 
            : 'text-gray-600 hover:bg-gray-100 hover:text-black',
          isCollapsed ? 'justify-center' : ''
        ]"
      >
        <component :is="item.icon" size="20" class="shrink-0" />
        
        <span 
          v-if="!isCollapsed" 
          class="font-medium font-[Prompt] whitespace-nowrap overflow-hidden transition-all duration-300"
        >
          {{ item.name }}
        </span>

        <!-- Tooltip for collapsed state -->
        <div 
          v-if="isCollapsed"
          class="absolute left-full ml-2 px-2 py-1 bg-black text-white text-xs rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 transition-opacity"
        >
          {{ item.name }}
        </div>
      </a>
    </nav>


    <!-- Footer Actions -->
    <div class="p-4 border-t border-gray-100 space-y-2">
      <!-- User Profile -->
      <a href="/dashboard/profile" v-if="user" class="flex items-center gap-3 px-3 py-2 mb-2 rounded-lg bg-gray-50 border border-gray-100 hover:bg-gray-100 transition-colors group" :class="isCollapsed ? 'justify-center' : ''">
        <div class="w-8 h-8 rounded-full bg-black text-white flex items-center justify-center font-bold text-sm shrink-0">
          {{ user.dbName?.[0]?.toUpperCase() || user.user_metadata?.full_name?.[0]?.toUpperCase() || user.email?.[0]?.toUpperCase() || 'U' }}
        </div>
        
        <div v-if="!isCollapsed" class="overflow-hidden">
          <p class="text-sm font-medium text-gray-900 truncate font-[Prompt]">{{ user.dbName || user.user_metadata?.full_name || 'Usuario' }}</p>
          <p class="text-xs text-gray-500 truncate font-[Prompt]">{{ user.email }}</p>
        </div>
      </a>

      <button 
        @click="toggleCollapse" 
        class="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
      >
        <component :is="isCollapsed ? ChevronRight : ChevronLeft" size="20" class="shrink-0 mx-auto" />
      </button>

      <button 
        @click="handleLogout"
        class="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-red-600 hover:bg-red-50 transition-colors group relative"
      >
        <LogOut size="20" class="shrink-0" :class="{ 'mx-auto': isCollapsed }" />
        <span v-if="!isCollapsed" class="font-medium font-[Prompt]">Cerrar Sesión</span>
        
         <div 
          v-if="isCollapsed"
          class="absolute left-full ml-2 px-2 py-1 bg-black text-white text-xs rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 transition-opacity"
        >
          Cerrar Sesión
        </div>
      </button>
    </div>
  </aside>
</template>
