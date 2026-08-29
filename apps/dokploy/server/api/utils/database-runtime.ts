import {
	type DatabaseRuntimeState,
	inspectDatabaseServiceRuntime,
} from "@dokploy/server";

type DatabaseDeploymentStatus = "idle" | "running" | "done" | "error";

interface DatabaseServiceWithRuntime {
	appName: string;
	applicationStatus: DatabaseDeploymentStatus;
	serverId?: string | null;
}

export interface DatabaseRuntimeSummary {
	state: DatabaseRuntimeState;
	ready: boolean;
	taskState: string;
	message: string;
}

export const deriveDatabaseApplicationStatus = (
	deploymentStatus: DatabaseDeploymentStatus,
	runtimeState: DatabaseRuntimeState,
): DatabaseDeploymentStatus => {
	if (runtimeState === "running") return "done";
	if (runtimeState === "starting") return "running";
	if (runtimeState === "failed") return "error";
	if (runtimeState === "stopped") {
		return deploymentStatus === "idle" ? "idle" : "error";
	}
	if (runtimeState === "unknown" && deploymentStatus === "done") {
		// Do not render a green "done" indicator when Docker could not prove the
		// database is still alive. "running" is the existing neutral/loading UI.
		return "running";
	}
	return deploymentStatus;
};

/**
 * Attach live Docker state to a database API response. applicationStatus is
 * derived for existing UI consumers, while deploymentStatus preserves the
 * stored lifecycle value for diagnostics and the agent.
 */
export const withDatabaseRuntime = async <T extends DatabaseServiceWithRuntime>(
	service: T,
): Promise<
	Omit<T, "applicationStatus"> & {
		applicationStatus: DatabaseDeploymentStatus;
		deploymentStatus: DatabaseDeploymentStatus;
		runtime: DatabaseRuntimeSummary;
	}
> => {
	const deploymentStatus = service.applicationStatus;
	try {
		const runtime = await inspectDatabaseServiceRuntime(
			service.appName,
			service.serverId,
		);
		return {
			...service,
			applicationStatus: deriveDatabaseApplicationStatus(
				deploymentStatus,
				runtime.state,
			),
			deploymentStatus,
			runtime: {
				state: runtime.state,
				ready: runtime.ready,
				taskState: runtime.taskState,
				message: runtime.message,
			},
		};
	} catch (error) {
		return {
			...service,
			applicationStatus: deriveDatabaseApplicationStatus(
				deploymentStatus,
				"unknown",
			),
			deploymentStatus,
			runtime: {
				state: "unknown",
				ready: false,
				taskState: "unknown",
				message:
					error instanceof Error
						? `Could not inspect Docker runtime: ${error.message}`
						: "Could not inspect Docker runtime",
			},
		};
	}
};
