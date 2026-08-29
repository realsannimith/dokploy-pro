import { getRemoteDocker } from "../servers/remote-docker";

type DockerClient = Awaited<ReturnType<typeof getRemoteDocker>>;

export interface WaitForDatabaseServiceOptions {
	docker?: DockerClient;
	intervalMs?: number;
	requiredConsecutiveRunningChecks?: number;
	timeoutMs?: number;
	sleep?: (milliseconds: number) => Promise<void>;
}

export interface InspectDatabaseServiceOptions {
	docker?: DockerClient;
}

export type DatabaseRuntimeState =
	| "running"
	| "starting"
	| "failed"
	| "stopped"
	| "unknown";

const wait = (milliseconds: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const taskDetail = (task: {
	Status?: { State?: string; Err?: string; Message?: string };
}) => {
	const state = task.Status?.State ?? "unknown";
	const message = task.Status?.Err || task.Status?.Message;
	return message ? `${state}: ${message}` : state;
};

const STARTING_TASK_STATES = new Set([
	"new",
	"allocated",
	"pending",
	"assigned",
	"accepted",
	"preparing",
	"ready",
	"starting",
]);

const FAILED_TASK_STATES = new Set(["failed", "rejected", "orphaned"]);
const STOPPED_TASK_STATES = new Set(["complete", "shutdown", "remove"]);

/**
 * Read the current Docker truth for a database service. Database records keep
 * deployment lifecycle state, which can become stale when a Swarm task later
 * restarts or fails.
 */
export const inspectDatabaseServiceRuntime = async (
	appName: string,
	serverId?: string | null,
	options: InspectDatabaseServiceOptions = {},
) => {
	const docker = options.docker ?? (await getRemoteDocker(serverId));
	const [containers, tasks] = await Promise.all([
		docker.listContainers({
			filters: JSON.stringify({
				label: [`com.docker.swarm.service.name=${appName}`],
				status: ["running"],
			}),
			limit: 1,
		}),
		docker.listTasks({
			filters: JSON.stringify({ service: [appName] }),
		}),
	]);
	const latestTask = [...tasks].sort(
		(a: (typeof tasks)[number], b: (typeof tasks)[number]) =>
			(b.Version?.Index ?? 0) - (a.Version?.Index ?? 0),
	)[0];
	const taskState = latestTask?.Status?.State?.toLowerCase();
	const taskMessage = latestTask ? taskDetail(latestTask) : undefined;
	const container = containers[0];
	const containerUnhealthy =
		container?.Status?.toLowerCase().includes("(unhealthy)");

	if (container && !containerUnhealthy) {
		return {
			state: "running" as const,
			ready: true as const,
			container,
			taskState: taskState ?? "running",
			message: taskMessage ?? container.Status ?? "running",
		};
	}
	if (containerUnhealthy) {
		return {
			state: "failed" as const,
			ready: false as const,
			container,
			taskState: taskState ?? "running",
			message: `Container health check failed: ${container?.Status ?? "unhealthy"}`,
		};
	}
	if (taskState && STARTING_TASK_STATES.has(taskState)) {
		return {
			state: "starting" as const,
			ready: false as const,
			taskState,
			message: taskMessage ?? taskState,
		};
	}
	if (taskState && FAILED_TASK_STATES.has(taskState)) {
		return {
			state: "failed" as const,
			ready: false as const,
			taskState,
			message: taskMessage ?? taskState,
		};
	}
	if (taskState && STOPPED_TASK_STATES.has(taskState)) {
		return {
			state: "stopped" as const,
			ready: false as const,
			taskState,
			message: taskMessage ?? taskState,
		};
	}
	return {
		state: "unknown" as const,
		ready: false as const,
		taskState: taskState ?? "unknown",
		message: taskMessage ?? "No Swarm task or running container was found",
	};
};

/**
 * Wait until Docker reports a running container for a database's Swarm
 * service. Creating/updating a service only acknowledges the desired state;
 * it does not mean that the image started successfully.
 */
export const waitForDatabaseServiceRunning = async (
	appName: string,
	serverId?: string | null,
	options: WaitForDatabaseServiceOptions = {},
) => {
	const docker = options.docker ?? (await getRemoteDocker(serverId));
	const intervalMs = options.intervalMs ?? 1_000;
	const timeoutMs = options.timeoutMs ?? 60_000;
	const requiredConsecutiveRunningChecks = Math.max(
		1,
		options.requiredConsecutiveRunningChecks ?? 3,
	);
	const sleep = options.sleep ?? wait;
	const deadline = Date.now() + timeoutMs;
	let lastTaskDetail = "no Swarm task was created";
	let lastRuntimeState: DatabaseRuntimeState = "unknown";
	let consecutiveRunningChecks = 0;
	let withinDeadline = true;

	while (withinDeadline) {
		const runtime = await inspectDatabaseServiceRuntime(appName, serverId, {
			docker,
		});
		lastRuntimeState = runtime.state;
		lastTaskDetail = runtime.message;
		if (runtime.ready) {
			consecutiveRunningChecks += 1;
			if (consecutiveRunningChecks >= requiredConsecutiveRunningChecks) {
				return runtime.container;
			}
		} else {
			consecutiveRunningChecks = 0;
		}

		withinDeadline = Date.now() < deadline;
		if (withinDeadline) await sleep(intervalMs);
	}

	throw new Error(
		`Database service "${appName}" is not ready after ${Math.ceil(timeoutMs / 1_000)} seconds. Runtime status: ${lastRuntimeState}. Last Swarm task: ${lastTaskDetail}`,
	);
};
