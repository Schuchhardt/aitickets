// Catálogo de herramientas del MCP de administración. Cada familia vive en su archivo; org_* se genera desde las
// herramientas de productores (../mirror.ts).
import type { AdminToolDef } from "../registry";
import { overviewTools } from "./overview";
import { organizationTools } from "./organizations";
import { eventTools } from "./events";
import { analyticsTools } from "./analytics";
import { supportTools } from "./support";
import { activityTools } from "./activity";
import { mirrorTools } from "../mirror";

export const ADMIN_TOOLS: AdminToolDef[] = [
    ...overviewTools,
    ...analyticsTools,
    ...organizationTools,
    ...eventTools,
    ...supportTools,
    ...activityTools,
    ...mirrorTools,
];

const BY_NAME = new Map(ADMIN_TOOLS.map((t) => [t.name, t]));
if (BY_NAME.size !== ADMIN_TOOLS.length) throw new Error("Herramientas del MCP de admin con nombre duplicado");
export const getAdminTool = (name: string) => BY_NAME.get(name) || null;
