import { getRemoteDocker } from "../servers/remote-docker";

type DockerClient = Awaited<ReturnType<typeof getRemoteDocker>>;

export interface WaitForDatabaseServiceOptions {
	docker?: DockerClient;
	intervalMs?: number;
	timeoutMs?: number;
	sleep?: (milliseconds: number) => Promise<void>;
}

const wait = (milliseconds: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const taskDetail = (task: {
	Status?: { State?: string; Err?: string; Message?: string };
}) => {
	const state = task.Status?.State ?? "unknown";
	const message = task.Status?.Err || task.Status?.Message;
	return message ? `${state}: ${message}` : state;
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
	const sleep = options.sleep ?? wait;
	const deadline = Date.now() + timeoutMs;
	let lastTaskDetail = "no Swarm task was created";
	let withinDeadline = true;

	while (withinDeadline) {
		const containers = await docker.listContainers({
			filters: JSON.stringify({
				label: [`com.docker.swarm.service.name=${appName}`],
				status: ["running"],
			}),
			limit: 1,
		});
		if (containers[0]) return containers[0];

		const tasks = await docker.listTasks({
			filters: JSON.stringify({ service: [appName] }),
		});
		const latestTask = [...tasks].sort(
			(a: (typeof tasks)[number], b: (typeof tasks)[number]) =>
				(b.Version?.Index ?? 0) - (a.Version?.Index ?? 0),
		)[0];
		if (latestTask) lastTaskDetail = taskDetail(latestTask);

		withinDeadline = Date.now() < deadline;
		if (withinDeadline) await sleep(intervalMs);
	}

	throw new Error(
		`Database service "${appName}" did not start within ${Math.ceil(timeoutMs / 1_000)} seconds. Last Swarm task: ${lastTaskDetail}`,
	);
};
