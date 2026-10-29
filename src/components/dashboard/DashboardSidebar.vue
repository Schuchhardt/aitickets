<script setup>
import {
  LayoutDashboard,
  CalendarDays,
  Users,
  Ticket,
  Tag,
  DollarSign,
  Megaphone,
  UserCog,
  Settings,
  Globe,
  Bot,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  X
} from 'lucide-vue-next'
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import logoLight from '../../images/logo.png'

// Se renderiza en el servidor (DashboardLayout, client:load): nada de window/localStorage fuera de onMounted.
// currentPath e initialCollapsed llegan del servidor para que el primer render ya sea el definitivo.
const props = defineProps(['userJson', 'currentPath', 'initialCollapsed'])
const user = ref(props.userJson ? JSON.parse(props.userJson) : null)
const currentPath = ref(props.currentPath || '/dashboard')

// Escritorio: sidebar contraído (solo íconos), recordado entre páginas en una cookie (el servidor la lee para
// renderizarlo ya contraído). Mobile: cajón que se abre desde la barra superior del layout ([data-sidebar-open]).
const COLLAPSE_COOKIE = 'dashboard_sidebar_collapsed'
const LEGACY_COLLAPSE_KEY = 'dashboard_sidebar_collapsed'
const isCollapsed = ref(!!props.initialCollapsed)
const isMobileOpen = ref(false)

const saveCollapsed = (value) => {
  document.cookie = `${COLLAPSE_COOKIE}=${value ? '1' : '0'}; path=/dashboard; max-age=31536000; samesite=lax`
}
watch(isCollapsed, saveCollapsed)

const toggleCollapse = () => {
  isCollapsed.value = !isCollapsed.value
}

const openMobile = () => { isMobileOpen.value = true }
const closeMobile = () => { isMobileOpen.value = false }

// Evita que el contenido de atrás haga scroll con el cajón abierto
watch(isMobileOpen, (open) => {
  document.body.style.overflow = open ? 'hidden' : ''
})

const onDocumentClick = (e) => {
  if (e.target.closest?.('[data-sidebar-open]')) openMobile()
}
const onKeydown = (e) => {
  if (e.key === 'Escape') closeMobile()
}
// Al pasar a escritorio el cajón no aplica
let desktopQuery = null
const onBreakpointChange = (e) => { if (e.matches) closeMobile() }
// src/lib/dashboardNav.js avisa al hacer clic en un enlace del panel: el ítem se marca al tiro, sin esperar la página
const onNavigate = (e) => { if (e.detail?.path) currentPath.value = e.detail.path }
// Volver atrás desde la caché del navegador (bfcache): el ítem activo vuelve a ser el de esta página
const onPageShow = (e) => { if (e.persisted) currentPath.value = window.location.pathname }

onMounted(() => {
  // Antes se recordaba en localStorage: se pasa una vez a la cookie
  if (!document.cookie.includes(`${COLLAPSE_COOKIE}=`)) {
    try {
      if (localStorage.getItem(LEGACY_COLLAPSE_KEY) === '1') isCollapsed.value = true
    } catch { /* storage no disponible */ }
  }
  document.addEventListener('click', onDocumentClick)
  document.addEventListener('keydown', onKeydown)
  window.addEventListener('ait:navigate', onNavigate)
  window.addEventListener('pageshow', onPageShow)
  desktopQuery = window.matchMedia('(min-width: 768px)')
  desktopQuery.addEventListener('change', onBreakpointChange)
})
onUnmounted(() => {
  document.removeEventListener('click', onDocumentClick)
  document.removeEventListener('keydown', onKeydown)
  window.removeEventListener('ait:navigate', onNavigate)
  window.removeEventListener('pageshow', onPageShow)
  desktopQuery?.removeEventListener('change', onBreakpointChange)
  document.body.style.overflow = ''
})

// En mobile el cajón siempre va expandido
const collapsed = computed(() => isCollapsed.value && !isMobileOpen.value)

const isActive = (path) =>
  path === '/dashboard'
    ? currentPath.value === path || currentPath.value === `${path}/`
    : currentPath.value === path || currentPath.value.startsWith(`${path}/`)

const handleLogout = async () => {
  await fetch('/api/auth/logout', { method: 'POST' })
  window.location.href = '/organizadores/login'
}

const EVENT_MANAGER_ROLES = ['admin', 'producer', 'editor']
const ORG_ADMIN_ROLES = ['admin', 'producer']
// finance: ingresos y configuración (datos bancarios); viewer: solo lectura
const OVERVIEW_ROLES = [...EVENT_MANAGER_ROLES, 'finance', 'viewer']
const API_ROLES = [...EVENT_MANAGER_ROLES, 'finance', 'validator', 'viewer']

// roles: quién ve cada ítem (el servidor también valida en cada página/API)
const allMenuItems = [
  { name: 'Resumen', path: '/dashboard', icon: LayoutDashboard, roles: OVERVIEW_ROLES },
  { name: 'Mis Eventos', path: '/dashboard/events', icon: CalendarDays, roles: null },
  { name: 'Entradas', path: '/dashboard/tickets', icon: Ticket, roles: EVENT_MANAGER_ROLES },
  { name: 'Comunidad', path: '/dashboard/community', icon: Users, roles: EVENT_MANAGER_ROLES },
  { name: 'Descuentos', path: '/dashboard/descuentos', icon: Tag, roles: EVENT_MANAGER_ROLES },
  { name: 'Ingresos', path: '/dashboard/finance', icon: DollarSign, roles: [...ORG_ADMIN_ROLES, 'finance'] },
  { name: 'Promocionar', path: '/dashboard/promote', icon: Megaphone, roles: EVENT_MANAGER_ROLES },
  { name: 'Conecta tu IA', path: '/dashboard/ia', icon: Bot, roles: API_ROLES },
  { name: 'Mi sitio web', path: '/dashboard/sitio', icon: Globe, roles: ORG_ADMIN_ROLES },
  { name: 'Equipo', path: '/dashboard/team', icon: UserCog, roles: ORG_ADMIN_ROLES },
  { name: 'Configuración', path: '/dashboard/settings', icon: Settings, roles: [...ORG_ADMIN_ROLES, 'finance'] },
]
const menuItems = allMenuItems.filter(item => !item.roles || item.roles.includes(user.value?.role || ''))
</script>

<template>
  <!-- Fondo del cajón en mobile -->
  <div
    v-if="isMobileOpen"
    class="fixed inset-0 bg-black/50 z-40 md:hidden"
    aria-hidden="true"
    @click="closeMobile"
  ></div>

  <aside
    id="dashboard-sidebar"
    class="bg-white border-r border-gray-200 h-dvh flex flex-col transition-all duration-300 z-50 fixed inset-y-0 left-0 w-72 max-w-[85vw] md:sticky md:top-0 md:max-w-none md:translate-x-0 shrink-0"
    :class="[
      isMobileOpen ? 'translate-x-0 shadow-xl' : '-translate-x-full',
      isCollapsed ? 'md:w-20' : 'md:w-64'
    ]"
  >
    <!-- Header -->
    <div
      class="px-4 flex items-center border-b border-gray-100 h-16 shrink-0 gap-2"
      :class="collapsed ? 'justify-center' : 'justify-between'"
    >
      <a v-if="!collapsed" href="/dashboard" class="flex items-center overflow-hidden">
        <img :src="logoLight.src" alt="AI Tickets" class="h-8" />
      </a>

      <!-- Escritorio: contraer / expandir -->
      <button
        type="button"
        @click="toggleCollapse"
        class="hidden md:flex items-center justify-center w-9 h-9 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-black transition-colors"
        :aria-label="isCollapsed ? 'Expandir menú' : 'Contraer menú'"
        :title="isCollapsed ? 'Expandir menú' : 'Contraer menú'"
        :aria-expanded="!isCollapsed"
        aria-controls="dashboard-sidebar"
      >
        <component :is="isCollapsed ? PanelLeftOpen : PanelLeftClose" size="20" />
      </button>

      <!-- Mobile: cerrar cajón -->
      <button
        type="button"
        @click="closeMobile"
        class="md:hidden flex items-center justify-center w-10 h-10 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-black"
        aria-label="Cerrar menú"
      >
        <X size="22" />
      </button>
    </div>

    <!-- Navigation -->
    <nav class="flex-1 py-4 md:py-6 px-3 space-y-1 md:space-y-2 overflow-y-auto">
      <a
        v-for="item in menuItems"
        :key="item.path"
        :href="item.path"
        class="flex items-center gap-3 px-3 py-3 rounded-lg transition-colors group relative"
        :class="[
          isActive(item.path)
            ? 'bg-black text-white'
            : 'text-gray-600 hover:bg-gray-100 hover:text-black',
          collapsed ? 'justify-center' : ''
        ]"
        :title="collapsed ? item.name : undefined"
        :aria-current="isActive(item.path) ? 'page' : undefined"
        @click="closeMobile"
      >
        <component :is="item.icon" size="20" class="shrink-0" />

        <span
          v-if="!collapsed"
          class="font-medium font-[Prompt] whitespace-nowrap overflow-hidden"
        >
          {{ item.name }}
        </span>
        <span v-else class="sr-only">{{ item.name }}</span>
      </a>
    </nav>

    <!-- Footer Actions -->
    <div class="p-3 md:p-4 border-t border-gray-100 space-y-2 shrink-0 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <!-- User Profile -->
      <a
        href="/dashboard/profile"
        v-if="user"
        class="flex items-center gap-3 px-3 py-2 rounded-lg bg-gray-50 border border-gray-100 hover:bg-gray-100 transition-colors"
        :class="collapsed ? 'justify-center' : ''"
        :title="collapsed ? 'Mi perfil' : undefined"
      >
        <div class="w-8 h-8 rounded-full bg-black text-white flex items-center justify-center font-bold text-sm shrink-0">
          {{ user.dbName?.[0]?.toUpperCase() || user.user_metadata?.full_name?.[0]?.toUpperCase() || user.email?.[0]?.toUpperCase() || 'U' }}
        </div>

        <div v-if="!collapsed" class="overflow-hidden min-w-0">
          <p class="text-sm font-medium text-gray-900 truncate font-[Prompt]">{{ user.dbName || user.user_metadata?.full_name || 'Usuario' }}</p>
          <p class="text-xs text-gray-500 truncate font-[Prompt]">{{ user.email }}</p>
        </div>
      </a>

      <button
        @click="handleLogout"
        class="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-red-600 hover:bg-red-50 transition-colors"
        :class="collapsed ? 'justify-center' : ''"
        :title="collapsed ? 'Cerrar Sesión' : undefined"
      >
        <LogOut size="20" class="shrink-0" />
        <span v-if="!collapsed" class="font-medium font-[Prompt]">Cerrar Sesión</span>
        <span v-else class="sr-only">Cerrar Sesión</span>
      </button>
    </div>
  </aside>
</template>
