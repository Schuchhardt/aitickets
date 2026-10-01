// Catálogo de herramientas de la API de productores (MCP + REST).
import type { ToolDef } from "../registry";
import { eventTools } from "./events";
import { ticketTools } from "./tickets";
import { discountTools } from "./discounts";
import { analyticsTools } from "./analytics";
import { marketingTools } from "./marketing";

export const TOOLS: ToolDef[] = [...eventTools, ...ticketTools, ...discountTools, ...analyticsTools, ...marketingTools];

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));
export const getTool = (name: string) => BY_NAME.get(name) || null;
