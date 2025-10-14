# AI Tickets

Este proyecto es una aplicación para la venta y visualización de eventos, construida con:

- **Astro** para el frontend
- **Supabase** como base de datos (PostgreSQL)
- **Netlify Functions** para manejo de compras, suscripciones a newsletter y más

---

## 📁 Estructura del Proyecto

```
.
├── db/                       # Migraciones e info de la base de datos
├── netlify/functions/       # Funciones serverless (newsletter, purchase-tickets)
│   ├── newsletter/
│   └── purchase-tickets/
├── public/                  # Archivos públicos
├── src/                     # Código fuente de Astro (páginas, componentes, layouts)
├── .env.example             # Variables de entorno de ejemplo
├── astro.config.mjs
├── netlify.toml             # Configuración de Netlify
└── package.json
```

---

## 🛠️ Cómo ejecutar localmente

### 1. Clonar el repositorio

```bash
git clone https://github.com/Schuchhardt/aitickets.git
cd aitickets
```

### 2. Instalar dependencias

```bash
yarn install
```

### 3. Configurar variables de entorno

Copia el archivo de ejemplo y edítalo con tus claves de Supabase:

```bash
cp .env.example .env
```

### 4. Correr Astro en modo desarrollo (sin funciones)

```bash
yarn dev
```

Esto levantará el sitio en http://localhost:3000

---

## 🧪 Ejecutar funciones localmente con netlify dev

Si deseas probar las funciones serverless localmente junto a Astro, haz lo siguiente:

### 1. Instalar la CLI de Netlify

```bash
npm install -g netlify-cli
```

### 2. Ejecutar el servidor de desarrollo completo

```bash
netlify dev
```

Esto iniciará la app en http://localhost:8888 y levantará las funciones desde netlify/functions.

> Las rutas como /api/purchase-tickets y /api/newsletter estarán disponibles localmente.

### 3. Estructura esperada de funciones

Cada carpeta dentro de netlify/functions/ debe tener su propio package.json y node_modules, por ejemplo:

```
netlify/
└── functions/
    ├── purchase-tickets/
    │   ├── index.mjs
    │   ├── package.json
    │   └── node_modules/
    └── newsletter/
        ├── index.mjs
        ├── package.json
        └── node_modules/
```

---

## 🧪 Testing E2E con Playwright

Este proyecto incluye una suite completa de tests end-to-end con Playwright.

### Ejecutar tests

```bash
# Ejecutar todos los tests (levanta servidor automáticamente)
npm run e2e

# Solo smoke tests (rápidos)
npm run test:e2e:smoke

# Modo UI interactivo (recomendado para desarrollo)
npm run test:e2e:ui

# Ver navegador mientras corren los tests
npm run test:e2e:headed

# Ver reporte del último run
npx playwright show-report e2e/report
```

### Documentación de tests

- **[E2E_INTEGRATION_SUMMARY.md](./E2E_INTEGRATION_SUMMARY.md)** - Resumen completo de la integración
- **[E2E_CHECKLIST.md](./E2E_CHECKLIST.md)** - Checklist de tareas pendientes
- **[e2e/README.md](./e2e/README.md)** - Documentación completa de tests
- **[e2e/QUICKSTART.md](./e2e/QUICKSTART.md)** - Guía rápida
- **[e2e/DATA_TESTID_GUIDE.md](./e2e/DATA_TESTID_GUIDE.md)** - Guía para agregar data-testids

### Crear nuevos tests

1. Agregar `data-testid` a tu componente Vue/Astro
2. Actualizar `e2e/support/test-ids.ts`
3. Crear/actualizar Page Object en `e2e/pages/<feature>/`
4. Escribir tests en `e2e/pages/<feature>/tests/`

Ver guías en `e2e/` para más detalles.

---

## ⚙️ Configuración de netlify.toml

Ya incluida en el proyecto:

```toml
[build]
  command = "npm run build"
  publish = "dist"
  functions = "netlify/functions"

[functions]
  directory = "netlify/functions"
  node_bundler = "esbuild"
  included_files = [
    "netlify/functions/**/package.json",
    "netlify/functions/**/node_modules/**",
    ".env"
  ]
```
