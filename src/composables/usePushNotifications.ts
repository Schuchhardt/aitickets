import { ref, onMounted } from 'vue'

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

export function usePushNotifications() {
  const supported = ref(false)
  const permission = ref<NotificationPermission>('default')
  const subscribed = ref(false)
  const loading = ref(false)

  const checkSupport = () => {
    if (typeof window === 'undefined') return false
    return 'PushManager' in window && 'serviceWorker' in navigator
  }

  const getRegistration = async (): Promise<ServiceWorkerRegistration | null> => {
    try {
      return await navigator.serviceWorker.ready
    } catch {
      return null
    }
  }

  const checkSubscription = async () => {
    try {
      const reg = await getRegistration()
      if (!reg) return
      const sub = await reg.pushManager.getSubscription()
      subscribed.value = !!sub
    } catch {
      subscribed.value = false
    }
  }

  const subscribe = async () => {
    if (!supported.value || loading.value) return
    loading.value = true
    try {
      const perm = await Notification.requestPermission()
      permission.value = perm
      if (perm !== 'granted') return

      const reg = await getRegistration()
      if (!reg) throw new Error('Service Worker no disponible')

      const keyRes = await fetch('/api/push/vapid-key')
      if (!keyRes.ok) throw new Error('No se pudo obtener la clave VAPID')
      const { publicKey } = await keyRes.json()

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey).buffer as ArrayBuffer,
      })

      const saveRes = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub.toJSON()),
      })
      if (!saveRes.ok) throw new Error('No se pudo guardar la suscripción')

      subscribed.value = true
    } catch (err) {
      console.error('Error al suscribirse a notificaciones:', err)
      throw err
    } finally {
      loading.value = false
    }
  }

  const unsubscribe = async () => {
    if (loading.value) return
    loading.value = true
    try {
      const reg = await getRegistration()
      if (!reg) return
      const sub = await reg.pushManager.getSubscription()
      if (!sub) {
        subscribed.value = false
        return
      }

      await fetch('/api/push/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      })

      await sub.unsubscribe()
      subscribed.value = false
    } catch (err) {
      console.error('Error al desuscribirse de notificaciones:', err)
      throw err
    } finally {
      loading.value = false
    }
  }

  onMounted(() => {
    supported.value = checkSupport()
    if (supported.value) {
      permission.value = Notification.permission
      checkSubscription()
    }
  })

  return { supported, permission, subscribed, loading, subscribe, unsubscribe }
}
