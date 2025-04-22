<script setup>
import { reactive, ref } from 'vue'
import * as z from 'zod'

const loading = ref(false)
const globalError = ref('')

const buyerInfo = reactive({
  name: '',
  email: '',
  password: '',
  confirmPassword: '',
  phone: '',
  organizationName: '',
  termsAccepted: false
})

const errors = ref({})

// Esquema Zod 
const registerSchema = z.object({
  name: z.string().min(1, 'El nombre es obligatorio'),
  email: z.string().email('Formato de email inválido'),
  password: z.string().min(6, 'La contraseña debe tener al menos 6 caracteres'),
  confirmPassword: z.string().min(1, 'Debes confirmar tu contraseña'),
  phone: z.string().regex(/^\+?[0-9\s-]+$/, 'El teléfono solo debe contener números y puede comenzar con +'),
  organizationName: z.string().min(1, 'El nombre de la organización es obligatorio'),
  termsAccepted: z.literal(true, {
    errorMap: () => ({ message: 'Debes aceptar los términos' })
  })
}).refine(data => data.password === data.confirmPassword, {
  path: ['confirmPassword'],
  message: 'Las contraseñas no coinciden'
})

const submitForm = async () => {
  const result = registerSchema.safeParse(buyerInfo)

  if (!result.success) {
    errors.value = result.error.flatten().fieldErrors
    const allErrors = Object.values(errors.value).flat()
    globalError.value = allErrors.length > 0 ? allErrors[0] : 'Error desconocido'
    return
  }

  errors.value = {}
  globalError.value = ''

  try {
    loading.value = true

    const hashRes = await fetch('https://api.aitickets.cl/hashpass', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: buyerInfo.password })
    })
    const hashData = await hashRes.json()
    if (!hashData.password_hashed) throw new Error('No se pudo encriptar la contraseña')

    const registerRes = await fetch('/api/register-producer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: buyerInfo.name,
        email: buyerInfo.email,
        password: hashData.password_hashed,
        organization_name: buyerInfo.organizationName,
        phone: buyerInfo.phone
      })
    })

    if (!registerRes.ok) throw new Error('Error al registrar')

    window.location.href = 'https://admin.aitickets.cl/login'
  } catch (err) {
    globalError.value = 'Ocurrió un error al registrar. Intenta de nuevo.'
    console.error('Error:', err.message)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="font-[Prompt] p-4">
    <p class="text-2xl text-gray-600 mb-4 font-[Unbounded]">Regístrate como productor</p>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div class="col-span-2">
        <input
          v-model="buyerInfo.name"
          type="text"
          placeholder="Nombre y Apellido*"
          :class="['p-2 rounded-md w-full', errors.name ? 'border-red-500 border' : 'border']"
        />
      </div>

      <div class="col-span-2">
        <input
          v-model="buyerInfo.email"
          type="email"
          placeholder="Correo electrónico*"
          :class="['p-2 rounded-md w-full', errors.email ? 'border-red-500 border' : 'border']"
        />
      </div>

      <div class="col-span-2">
        <input
          v-model="buyerInfo.password"
          type="password"
          placeholder="Contraseña*"
          :class="['p-2 rounded-md w-full', errors.password ? 'border-red-500 border' : 'border']"
        />
      </div>

      <div class="col-span-2">
        <input
          v-model="buyerInfo.confirmPassword"
          type="password"
          placeholder="Confirmar contraseña*"
          :class="['p-2 rounded-md w-full', errors.confirmPassword ? 'border-red-500 border' : 'border']"
        />
      </div>

      <div class="col-span-2">
        <input
          v-model="buyerInfo.phone"
          type="tel"
          placeholder="Teléfono*"
          :class="['p-2 rounded-md w-full', errors.phone ? 'border-red-500 border' : 'border']"
        />
      </div>

      <div class="col-span-2">
        <input
          v-model="buyerInfo.organizationName"
          type="text"
          placeholder="Nombre de la organización*"
          :class="['p-2 rounded-md w-full', errors.organizationName ? 'border-red-500 border' : 'border']"
        />
      </div>
    </div>

    <div class="flex items-center mt-4">
      <input
        v-model="buyerInfo.termsAccepted"
        type="checkbox"
        class="mr-3 cursor-pointer w-5 h-5 accent-black"
      />
      <label class="text-gray-600 text-sm leading-5">
        Acepto los
        <a href="/terms" class="text-black underline font-medium" target="_blank">Términos del Servicio</a>
        y
        <a href="/privacy" class="text-black underline font-medium" target="_blank">Políticas de Privacidad</a>
        <span class="text-red-500"> (Requerido)</span>
      </label>
    </div>

    <!-- ✅ Mensaje de error entre checkbox y botón -->
    <p v-if="globalError" class="text-red-500 text-sm mt-3 font-[Unbounded]">{{ globalError }}</p>

    <button
      @click="submitForm"
      type="button"
      aria-label="Boton de registro"
      class="bg-black text-white font-medium py-2 px-5 mt-6 rounded-md hover:bg-gray-800 transition duration-150 active:scale-95"
    >
      {{ loading ? 'Registrando...' : 'Registrarse' }}
    </button>
  </div>
</template>






