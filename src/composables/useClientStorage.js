import { ref, onMounted } from 'vue'

/**
 * Composable para manejar localStorage de manera segura en SSR
 * Solo accede a localStorage después de que el componente se monte en el cliente
 */
export function useClientStorage(key, defaultValue = null) {
  const storedValue = ref(defaultValue)
  const isClient = ref(false)

  onMounted(() => {
    isClient.value = true
    
    if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
      try {
        const item = localStorage.getItem(key)
        if (item !== null) {
          storedValue.value = JSON.parse(item)
        }
      } catch (error) {
        console.error(`Error reading localStorage key "${key}":`, error)
        storedValue.value = defaultValue
      }
    }
  })

  const setValue = (value) => {
    storedValue.value = value
    
    if (isClient.value && typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(key, JSON.stringify(value))
      } catch (error) {
        console.error(`Error writing localStorage key "${key}":`, error)
      }
    }
  }

  const removeValue = () => {
    storedValue.value = defaultValue
    
    if (isClient.value && typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
      try {
        localStorage.removeItem(key)
      } catch (error) {
        console.error(`Error removing localStorage key "${key}":`, error)
      }
    }
  }

  return {
    value: storedValue,
    setValue,
    removeValue,
    isClient
  }
}