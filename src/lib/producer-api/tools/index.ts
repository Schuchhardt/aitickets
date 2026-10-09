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

export const TOOLS: ToolDef[] = [
    ...eventTools, ...ticketTools, ...discountTools, ...analyticsTools, ...marketingTools,
    ...financeTools, ...teamTools, ...guestTools, ...accessTools, ...postsaleTools,
    ...messagingTools, ...lifecycleTools, ...auditTools,
];

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));
if (BY_NAME.size !== TOOLS.length) throw new Error("Herramientas de la API con nombre duplicado");
export const getTool = (name: string) => BY_NAME.get(name) || null;
