<script setup>

const loading = ref(false)

import { ref, onMounted } from 'vue'

const buyerInfo = ref({
  name: '',
  email: '',
  confirmEmail: '',
  password: '',
  confirmPassword: '',
  phone: '',
  organizationId: '',
  termsAccepted: false
})

const organizations = ref([])

onMounted(async () => {
  const res = await fetch('https://bgsmqjrdryafvlyxywud.supabase.co/rest/v1/organizations', {
    headers: {
      apikey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJnc21xanJkcnlhZnZseXh5d3VkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzk5MDk1MDIsImV4cCI6MjA1NTQ4NTUwMn0._WHWk0csFD5k0PsVtT0nGuvgrgKlx7INGMcWzF2zyZ0',
      Authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJnc21xanJkcnlhZnZseXh5d3VkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzk5MDk1MDIsImV4cCI6MjA1NTQ4NTUwMn0._WHWk0csFD5k0PsVtT0nGuvgrgKlx7INGMcWzF2zyZ0'
    }
  })
  organizations.value = await res.json()
})

const registerProducer = async (registerInfo) => {
  // Validaciones
  const requiredFields = [
    registerInfo.name,
    registerInfo.email,
    registerInfo.confirmEmail,
    registerInfo.password,
    registerInfo.confirmPassword,
    registerInfo.organizationId,
    registerInfo.phone
  ]
  const hasEmptyField = requiredFields.some(field => String(field).trim() === '')
  if (hasEmptyField) return alert('Por favor completa todos los campos obligatorios.')

   //Validación de email con formato correcto
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(registerInfo.email)) {
    return alert('El correo no tiene un formato válido.')
  }

  //Validación de teléfono: solo números
  const phoneRegex = /^\+?\d+$/
  if (!phoneRegex.test(registerInfo.phone)) {
    return alert('El teléfono solo debe contener números.')
  }

  if (registerInfo.email !== registerInfo.confirmEmail) return alert('Los correos electrónicos no coinciden.')
  if (registerInfo.password !== registerInfo.confirmPassword) return alert('Las contraseñas no coinciden.')
  if (!registerInfo.termsAccepted) return alert('Debes aceptar los Términos y Políticas para continuar.')

  try {
    loading.value = true

    // Encriptar password
    const hashRes = await fetch('https://api.aitickets.cl/hashpass', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: registerInfo.password })
    })
    const hashData = await hashRes.json()
    if (!hashData.password_hashed) throw new Error('No se pudo encriptar la contraseña')

    // Enviar a Netlify Function
    const registerRes = await fetch('/.netlify/functions/registerProducer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: registerInfo.name,
        email: registerInfo.email,
        password: hashData.password_hashed,
        organization_id: registerInfo.organizationId,
        phone: registerInfo.phone
      })
    })

    if (!registerRes.ok) throw new Error('Error al registrar')

    window.location.href = 'https://admin.aitickets.cl/login'
  } catch (err) {
    alert('Error: ' + err.message)
  } finally {
    loading.value = false
  }
}
</script>


<template>
  <div class="font-[Prompt] p-4">
    <p class="text-2xl text-gray-600 mb-4">Regístrate como productor</p>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <input
        v-model="buyerInfo.name"
        type="text"
        placeholder="Nombre y Apellido*"
        class="border p-2 rounded-md w-full col-span-2"
      />

      <input
        v-model="buyerInfo.email"
        type="email"
        placeholder="Correo electrónico*"
        class="border p-2 rounded-md w-full col-span-2"
      />
      <input
        v-model="buyerInfo.confirmEmail"
        type="email"
        placeholder="Confirmar correo electrónico*"
        class="border p-2 rounded-md w-full col-span-2"
      />
      <input
        v-model="buyerInfo.password"
        type="password"
        placeholder="Contraseña*"
        class="border p-2 rounded-md w-full col-span-2"
      />
      <input
        v-model="buyerInfo.confirmPassword"
        type="password"
        placeholder="Confirmar contraseña*"
        class="border p-2 rounded-md w-full col-span-2"
      />
      <input
        v-model="buyerInfo.phone"
        type="tel"
        placeholder="Teléfono*"
        class="border p-2 rounded-md w-full col-span-2"
      />

      <!-- Select de organización -->
      <select
  v-model="buyerInfo.organizationId"
  class="border p-2 rounded-md w-full col-span-2 bg-white text-gray-700"
>
  <option disabled value="">Selecciona una productora*</option>
  <option v-for="org in organizations" :key="org.id" :value="org.id">
    {{ org.public_name }}
  </option>
</select>

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

    <button
      @click="registerProducer(buyerInfo)"
      type="button"
      class="bg-black text-white font-medium py-2 px-5 mt-6 rounded-md hover:bg-gray-800 transition duration-150 active:scale-95"
    >
      {{ loading ? 'Registrando...' : 'Registrarse' }}
    </button>
  </div>
</template>



