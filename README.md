# aitickets-app

Este proyecto es un ejemplo de aplicación para venta y visualización de eventos,
usando Astro en el frontend, Supabase como base de datos Postgres y, opcionalmente,
Netlify Functions para manejar compras de tickets.

## Estructura

- **db/**: Contiene migraciones e información de la base de datos.
- **netlify/functions/**: Funciones serverless para Netlify (manejo de compras, publicación a colas, etc.).
- **src/**: Contiene el código fuente de Astro (páginas, componentes, layouts) y el cliente de Supabase.

## Cómo ejecutar localmente

1. Clonar el repositorio:
   ```bash
   git clone https://github.com/tu-usuario/my-aitickets-app.git
   cd my-aitickets-app
    ```

2. Instalar dependencias:

```bash
yarn install
```

Copiar .env.example a .env y agregar tus valores de Supabase:

```bash
cp .env.example .env
# Edita .env con tus claves
```

3. Ejecutar en modo desarrollo:

```bash
yarn run dev
```
Visita http://localhost:3000 para ver la app.

## Despliegue en Netlify
Conecta este repo a tu cuenta de Netlify.
En "Build Settings", define npm run build y la carpeta de salida (dist por defecto en Astro).
Configura las variables de entorno en Netlify (SUPABASE_URL, SUPABASE_ANON_KEY, etc.).
¡Listo para usar!
