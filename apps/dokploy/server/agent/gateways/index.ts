import type { AgentChannelCredentials } from "@dokploy/server/db/schema/agent";
import {
	findAgentByOrganizationId,
	findAllRunnableChannels,
	findChannelsByAgentId,
} from "@dokploy/server/services/agent";
import { startDiscord } from "./discord";
import { startEmail } from "./email";
import { startSignal } from "./signal";
import { startSlack } from "./slack";
import { startTelegram } from "./telegram";
import type { GatewayHandle, GatewayStarter } from "./types";

// WhatsApp is webhook-driven (see pages/api/agent/whatsapp.ts), so it has no
// long-lived process to supervise here.
const STARTERS: Partial<Record<string, GatewayStarter>> = {
	telegram: startTelegram,
	discord: startDiscord,
	slack: startSlack,
	signal: startSignal,
	email: startEmail,
};

// Survives Next.js dev-mode module reloads.
const globalStore = globalThis as unknown as {
	__dokployAgentGateways?: Map<string, GatewayHandle>;
};
if (!globalStore.__dokployAgentGateways) {
	globalStore.__dokployAgentGateways = new Map();
}
const running = globalStore.__dokployAgentGateways;

export const stopChannel = (channelId: string) => {
	const handle = running.get(channelId);
	if (handle) {
		handle.stop();
		running.delete(channelId);
	}
};

export const stopAllChannels = () => {
	for (const channelId of [...running.keys()]) {
		stopChannel(channelId);
	}
};

const startChannel = (channel: {
	channelId: string;
	agentId: string;
	type: string;
	credentials: AgentChannelCredentials;
}) => {
	const starter = STARTERS[channel.type];
	if (!starter) return;
	stopChannel(channel.channelId);
	try {
		const handle = starter({
			channelId: channel.channelId,
			agentId: channel.agentId,
			credentials: channel.credentials,
		});
		running.set(channel.channelId, handle);
		console.log(
			`[agent-gateway] ${channel.type} gateway started (${channel.channelId})`,
		);
	} catch (error) {
		console.error(
			`[agent-gateway] Failed to start ${channel.type} gateway:`,
			error instanceof Error ? error.message : error,
		);
	}
};

/** Restart exactly the channels of one organization after a settings change. */
export const reloadAgentGateways = async (organizationId: string) => {
	const agent = await findAgentByOrganizationId(organizationId);
	if (!agent) return;
	const channels = await findChannelsByAgentId(agent.agentId);
	for (const channel of channels) {
		if (agent.isEnabled && channel.isEnabled) {
			startChannel(channel);
		} else {
			stopChannel(channel.channelId);
		}
	}
};

export const initAgentGateways = async () => {
	try {
		const channels = await findAllRunnableChannels();
		for (const channel of channels) {
			startChannel(channel);
		}
		if (channels.length > 0) {
			console.log(`[agent-gateway] Started ${channels.length} gateway(s)`);
		}
	} catch (error) {
		console.error("[agent-gateway] Failed to initialize gateways", error);
	}
};
