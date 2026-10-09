// Permisos por ROL de la API de productores. La llave (scopes) limita lo que una app conectada puede hacer;
// el rol del usuario dueño de la llave limita lo que esa persona puede hacer. Una herramienta exige ambos.
//
// Roles (users.role):
//   producer  Dueño de la cuenta        admin     Administrador
//   finance   Finanzas (contador)       editor    Marketing / editor de eventos
//   validator Puerta (check-in)         viewer    Solo lectura
export const ROLE_LABELS: Record<string, string> = {
    producer: "Dueño",
    admin: "Administrador",
    finance: "Finanzas",
    editor: "Marketing",
    validator: "Puerta",
    viewer: "Solo lectura",
};

/** Roles que se pueden asignar a un miembro (el dueño no se asigna). */
export const ASSIGNABLE_ROLES = ["admin", "finance", "editor", "validator", "viewer"] as const;

/** Roles que pueden usar la API (cada herramienta filtra además por permiso). */
export const API_ROLES = ["producer", "admin", "finance", "editor", "validator", "viewer"];

export const PERMISSIONS = [
    "events.read",
    "events.write",
    "events.publish",
    "attendees.read",
    "checkin",
    "orders.support",
    "guests.manage",
    "messages.send",
    "finance.read",
    "finance.manage",
    "team.read",
    "team.manage",
    "audit.read",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_LABELS: Record<Permission, string> = {
    "events.read": "Ver eventos, entradas, descuentos y estadísticas",
    "events.write": "Crear y editar eventos, entradas, descuentos e imágenes",
    "events.publish": "Publicar eventos y publicar en redes",
    "attendees.read": "Ver compradores y asistentes",
    checkin: "Controlar el acceso (check-in)",
    "orders.support": "Atender compradores (reenviar y transferir entradas)",
    "guests.manage": "Gestionar invitados y cortesías",
    "messages.send": "Enviar mensajes a los asistentes",
    "finance.read": "Ver comisiones, saldo, retiros y liquidaciones",
    "finance.manage": "Retiros, reembolsos y cuenta bancaria",
    "team.read": "Ver el equipo",
    "team.manage": "Invitar, cambiar roles y quitar acceso",
    "audit.read": "Ver la bitácora de acciones",
};

const ALL = [...PERMISSIONS];

export const ROLE_PERMISSIONS: Record<string, readonly Permission[]> = {
    producer: ALL,
    admin: ALL.filter((p) => p !== "finance.manage"),
    finance: ["events.read", "attendees.read", "orders.support", "finance.read", "finance.manage", "team.read", "audit.read"],
    editor: ["events.read", "events.write", "events.publish", "attendees.read", "checkin", "orders.support", "guests.manage", "messages.send", "team.read"],
    // Puerta: ve asistentes y controla el acceso; no transfiere entradas ni exporta datos (eso es orders.support / attendees.read)
    validator: ["events.read", "checkin"],
    viewer: ["events.read", "team.read"],
};

export function roleAllows(role: string | null | undefined, permission: Permission): boolean {
    return (ROLE_PERMISSIONS[String(role || "")] || []).includes(permission);
}

/** Roles que tienen un permiso (para mensajes de error). */
export function rolesWith(permission: Permission): string[] {
    return Object.keys(ROLE_PERMISSIONS).filter((r) => ROLE_PERMISSIONS[r].includes(permission));
}
