export type DeploymentLifecycleStatus =
	| "running"
	| "done"
	| "error"
	| "cancelled"
	| null;

export interface DeploymentObservationSource {
	deploymentId: string;
	status: DeploymentLifecycleStatus;
	title: string;
	description?: string | null;
	errorMessage?: string | null;
	createdAt: string;
	startedAt?: string | null;
	finishedAt?: string | null;
	applicationId?: string | null;
	composeId?: string | null;
	serverId?: string | null;
	buildServerId?: string | null;
	application?: {
		applicationId?: string;
		name?: string;
		appName?: string;
		serverId?: string | null;
	} | null;
	compose?: {
		composeId?: string;
		name?: string;
		appName?: string;
		serverId?: string | null;
	} | null;
	schedule?: { serverId?: string | null } | null;
}

export const isDeploymentTerminal = (
	status: DeploymentLifecycleStatus,
): boolean => status === "done" || status === "error" || status === "cancelled";

export const resolveDeploymentLogServerId = (
	deployment: DeploymentObservationSource,
): string | null =>
	deployment.buildServerId ||
	deployment.serverId ||
	deployment.schedule?.serverId ||
	deployment.application?.serverId ||
	deployment.compose?.serverId ||
	null;

export const summarizeDeploymentObservation = (
	deployment: DeploymentObservationSource,
	options: { logs?: string; timedOut?: boolean } = {},
) => {
	const status = deployment.status;
	const terminal = isDeploymentTerminal(status);
	const service = deployment.applicationId
		? {
				type: "application" as const,
				id: deployment.applicationId,
				name:
					deployment.application?.name ||
					deployment.application?.appName ||
					null,
			}
		: deployment.composeId
			? {
					type: "compose" as const,
					id: deployment.composeId,
					name: deployment.compose?.name || deployment.compose?.appName || null,
				}
			: null;

	return {
		found: true as const,
		deploymentId: deployment.deploymentId,
		status,
		state:
			status === "done"
				? ("succeeded" as const)
				: status === "error"
					? ("failed" as const)
					: status === "cancelled"
						? ("cancelled" as const)
						: status === "running"
							? ("in-progress" as const)
							: ("unknown" as const),
		terminal,
		success: status === "done",
		timedOut: options.timedOut ?? false,
		title: deployment.title,
		description: deployment.description ?? null,
		errorMessage: deployment.errorMessage ?? null,
		createdAt: deployment.createdAt,
		startedAt: deployment.startedAt ?? null,
		finishedAt: deployment.finishedAt ?? null,
		service,
		logs: options.logs ?? "",
		observedAt: new Date().toISOString(),
	};
};

export interface PollDeploymentOptions<T> {
	load: () => Promise<T | null>;
	isComplete: (deployment: T) => boolean;
	timeoutMs: number;
	pollIntervalMs: number;
	now?: () => number;
	sleep?: (milliseconds: number) => Promise<void>;
}

export const pollDeployment = async <T>({
	load,
	isComplete,
	timeoutMs,
	pollIntervalMs,
	now = Date.now,
	sleep = (milliseconds) =>
		new Promise<void>((resolve) => setTimeout(resolve, milliseconds)),
}: PollDeploymentOptions<T>): Promise<{
	deployment: T | null;
	timedOut: boolean;
}> => {
	const deadline = now() + timeoutMs;
	let latest: T | null = null;

	while (true) {
		latest = await load();
		if (latest && isComplete(latest)) {
			return { deployment: latest, timedOut: false };
		}

		const remaining = deadline - now();
		if (remaining <= 0) {
			return { deployment: latest, timedOut: true };
		}

		await sleep(Math.min(pollIntervalMs, remaining));
	}
};
