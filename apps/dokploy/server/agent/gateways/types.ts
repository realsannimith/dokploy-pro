import type { AgentChannelCredentials } from "@dokploy/server/db/schema/agent";

export interface GatewayHandle {
	stop: () => void;
}

export interface GatewayStartInput {
	channelId: string;
	agentId: string;
	credentials: AgentChannelCredentials;
}

export type GatewayStarter = (input: GatewayStartInput) => GatewayHandle;

export const sleep = (ms: number) =>
	new Promise((resolve) => setTimeout(resolve, ms));
