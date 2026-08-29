import type { AgentChannelCredentials } from "@dokploy/server/db/schema/agent";

export interface GatewayHandle {
	stop: () => void;
}

export interface GatewayStartInput {
	channelId: string;
	agentId: string;
	credentials: AgentChannelCredentials;
	/** Report a fatal, non-retryable exit (e.g. rejected token) so the UI can show it. */
	onFatal?: (message: string) => void;
}

export type GatewayStarter = (input: GatewayStartInput) => GatewayHandle;

export const sleep = (ms: number) =>
	new Promise((resolve) => setTimeout(resolve, ms));
