import type { APIRoute } from "astro";

export const POST: APIRoute = async ({ cookies }) => {
    try {
        // Eliminar las cookies de sesión
        cookies.delete("sb-access-token", { path: "/" });
        cookies.delete("sb-refresh-token", { path: "/" });

        return new Response(JSON.stringify({ message: "Sesión cerrada correctamente" }), { 
            status: 200,
            headers: { "Content-Type": "application/json" }
        });

    } catch (error) {
        console.error("Logout error:", error);
        return new Response(JSON.stringify({ message: "Error al cerrar sesión" }), { 
            status: 500,
            headers: { "Content-Type": "application/json" }
        });
    }
};
