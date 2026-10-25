// Catálogo de herramientas de la API de productores (MCP + REST).
import type { ToolDef } from "../registry";
import { eventTools } from "./events";
import { ticketTools } from "./tickets";
import { discountTools } from "./discounts";
import { analyticsTools } from "./analytics";
import { marketingTools } from "./marketing";
import { financeTools } from "./finance";
import { teamTools } from "./team";
import { guestTools } from "./guests";
import { accessTools } from "./access";
import { postsaleTools } from "./postsale";
import { messagingTools } from "./messaging";
import { lifecycleTools } from "./lifecycle";
import { auditTools } from "./audit";
import { scheduleTools } from "./schedule";
import { reviewTools } from "./reviews";
import { complianceTools } from "./compliance";

export const TOOLS: ToolDef[] = [
    ...eventTools, ...scheduleTools, ...ticketTools, ...discountTools, ...analyticsTools, ...marketingTools,
    ...financeTools, ...complianceTools, ...teamTools, ...guestTools, ...accessTools, ...postsaleTools,
    ...messagingTools, ...reviewTools, ...lifecycleTools, ...auditTools,
];

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));
if (BY_NAME.size !== TOOLS.length) throw new Error("Herramientas de la API con nombre duplicado");
export const getTool = (name: string) => BY_NAME.get(name) || null;
