import {
	execAsync,
	execAsyncRemote,
	findAllDeploymentsByApplicationId,
	findAllDeploymentsByComposeId,
	findAllDeploymentsByServerId,
	findAllDeploymentsCentralized,
	findDeploymentById,
	findScheduleById,
	IS_CLOUD,
	removeDeployment,
	resolveServicePath,
	updateDeploymentStatus,
} from "@dokploy/server";
import { db } from "@dokploy/server/db";
import {
	checkServicePermissionAndAccess,
	findMemberByUserId,
} from "@dokploy/server/services/permission";
import { findServerById } from "@dokploy/server/services/server";
import { TRPCError } from "@trpc/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { audit } from "@/server/api/utils/audit";
import {
	apiFindAllByApplication,
	apiFindAllByCompose,
	apiFindAllByServer,
	apiFindAllByType,
	deployments,
	server,
} from "@/server/db/schema";
import {
	isDeploymentTerminal,
	pollDeployment,
	resolveDeploymentLogServerId,
	summarizeDeploymentObservation,
} from "@/server/deployment-observability";
import { myQueue } from "@/server/queues/queueSetup";
import { fetchDeployApiJobs, type QueueJobRow } from "@/server/utils/deploy";
import { createTRPCRouter, protectedProcedure, withPermission } from "../trpc";

type DeploymentDetails = Awaited<ReturnType<typeof findDeploymentById>>;
type DeploymentContext = Parameters<typeof checkServicePermissionAndAccess>[0];

const assertDeploymentReadAccess = async (
	ctx: DeploymentContext,
	deployment: DeploymentDetails,
) => {
	const serviceId =
		deployment.applicationId ||
		deployment.composeId ||
		deployment.schedule?.applicationId ||
		deployment.schedule?.composeId;
	if (serviceId) {
		await checkServicePermissionAndAccess(ctx, serviceId, {
			deployment: ["read"],
		});
		return;
	}

	const serverId = deployment.schedule?.serverId || deployment.serverId;
	if (serverId) {
		const targetServer = await findServerById(serverId);
		if (targetServer.organizationId !== ctx.session.activeOrganizationId) {
			throw new TRPCError({
				code: "UNAUTHORIZED",
				message: "You don't have access to this deployment.",
			});
		}
		return;
	}

	if (
		deployment.schedule?.organizationId === ctx.session.activeOrganizationId
	) {
		return;
	}

	throw new TRPCError({
		code: "UNAUTHORIZED",
		message: "This deployment is not attached to an accessible service.",
	});
};

const readDeploymentLogTail = async (
	deployment: DeploymentDetails,
	tail: number,
) => {
	if (tail === 0 || !deployment.logPath) return "";

	const command = `tail -n ${tail} -- ${JSON.stringify(
		deployment.logPath,
	)} 2>/dev/null || true`;
	const serverId = resolveDeploymentLogServerId(deployment);
	if (serverId) {
		const { stdout } = await execAsyncRemote(serverId, command);
		return stdout;
	}

	if (IS_CLOUD) return "";
	const { stdout } = await execAsync(command);
	return stdout;
};

const findLatestDeployment = async (
	type: "application" | "compose",
	id: string,
	afterDeploymentId?: string,
): Promise<DeploymentDetails | null> => {
	const rows =
		type === "application"
			? await findAllDeploymentsByApplicationId(id)
			: await findAllDeploymentsByComposeId(id);
	const latest = rows[0];
	if (!latest || latest.deploymentId === afterDeploymentId) return null;
	return await findDeploymentById(latest.deploymentId);
};

const observationOptionsSchema = {
	tail: z.number().int().min(0).max(2000).default(100),
	timeoutSeconds: z.number().int().min(0).max(25).default(20),
	pollIntervalSeconds: z.number().int().min(1).max(5).default(2),
};

const missingDeploymentObservation = (message: string, timedOut: boolean) => ({
	found: false as const,
	terminal: false,
	success: false,
	timedOut,
	message,
	observedAt: new Date().toISOString(),
});

export const deploymentRouter = createTRPCRouter({
	all: protectedProcedure
		.input(apiFindAllByApplication)
		.query(async ({ input, ctx }) => {
			await checkServicePermissionAndAccess(ctx, input.applicationId, {
				deployment: ["read"],
			});
			return await findAllDeploymentsByApplicationId(input.applicationId);
		}),

	allByCompose: protectedProcedure
		.input(apiFindAllByCompose)
		.query(async ({ input, ctx }) => {
			await checkServicePermissionAndAccess(ctx, input.composeId, {
				deployment: ["read"],
			});
			return await findAllDeploymentsByComposeId(input.composeId);
		}),
	allByServer: withPermission("deployment", "read")
		.input(apiFindAllByServer)
		.query(async ({ input, ctx }) => {
			const targetServer = await findServerById(input.serverId);
			if (targetServer.organizationId !== ctx.session.activeOrganizationId) {
				throw new TRPCError({
					code: "UNAUTHORIZED",
					message: "You don't have access to this server.",
				});
			}
			return await findAllDeploymentsByServerId(input.serverId);
		}),
	allCentralized: withPermission("deployment", "read").query(
		async ({ ctx }) => {
			const orgId = ctx.session.activeOrganizationId;
			const accessedServices =
				ctx.user.role !== "owner" && ctx.user.role !== "admin"
					? (await findMemberByUserId(ctx.user.id, orgId)).accessedServices
					: null;
			if (accessedServices !== null && accessedServices.length === 0) {
				return [];
			}
			return findAllDeploymentsCentralized(orgId, accessedServices);
		},
	),

	queueList: withPermission("deployment", "read").query(async ({ ctx }) => {
		const orgId = ctx.session.activeOrganizationId;
		let rows: QueueJobRow[];

		if (IS_CLOUD) {
			const servers = await db.query.server.findMany({
				where: eq(server.organizationId, orgId),
				columns: { serverId: true },
			});
			const serverRowsArrays = await Promise.all(
				servers.map(({ serverId }) => fetchDeployApiJobs(serverId)),
			);
			rows = serverRowsArrays.flat();
			rows.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
		} else {
			const jobs = await myQueue.getJobs();
			const jobRows = await Promise.all(
				jobs.map(async (job) => {
					const state = await job.getState();
					return {
						id: String(job.id),
						name: job.name ?? undefined,
						data: job.data as Record<string, unknown>,
						timestamp: job.timestamp,
						processedOn: job.processedOn,
						finishedOn: job.finishedOn,
						failedReason: job.failedReason ?? undefined,
						state,
					};
				}),
			);
			jobRows.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
			rows = jobRows;
		}

		return Promise.all(
			rows.map(async (row) => ({
				...row,
				servicePath: await resolveServicePath(
					orgId,
					(row.data ?? {}) as Record<string, unknown>,
				),
			})),
		);
	}),

	allByType: protectedProcedure
		.input(apiFindAllByType)
		.query(async ({ input, ctx }) => {
			if (input.type === "schedule") {
				const schedule = await findScheduleById(input.id);
				const serviceId = schedule.applicationId || schedule.composeId;
				if (serviceId) {
					await checkServicePermissionAndAccess(ctx, serviceId, {
						deployment: ["read"],
					});
				} else if (schedule.serverId) {
					const targetServer = await findServerById(schedule.serverId);
					if (
						targetServer.organizationId !== ctx.session.activeOrganizationId
					) {
						throw new TRPCError({
							code: "UNAUTHORIZED",
							message: "You don't have access to this schedule.",
						});
					}
				}
			} else {
				await checkServicePermissionAndAccess(ctx, input.id, {
					deployment: ["read"],
				});
			}
			const deploymentsList = await db.query.deployments.findMany({
				where: eq(deployments[`${input.type}Id`], input.id),
				orderBy: desc(deployments.createdAt),
				with: {
					rollback: true,
				},
			});
			return deploymentsList;
		}),

	latest: protectedProcedure
		.input(
			z.object({
				type: z.enum(["application", "compose"]),
				id: z.string().min(1),
				tail: observationOptionsSchema.tail,
			}),
		)
		.query(async ({ input, ctx }) => {
			await checkServicePermissionAndAccess(ctx, input.id, {
				deployment: ["read"],
			});
			const deployment = await findLatestDeployment(input.type, input.id);
			if (!deployment) {
				return missingDeploymentObservation(
					"No deployment has been created for this service yet.",
					false,
				);
			}
			const logs = await readDeploymentLogTail(deployment, input.tail);
			return summarizeDeploymentObservation(deployment, { logs });
		}),

	inspect: protectedProcedure
		.input(
			z.object({
				deploymentId: z.string().min(1),
				tail: observationOptionsSchema.tail,
			}),
		)
		.query(async ({ input, ctx }) => {
			const deployment = await findDeploymentById(input.deploymentId);
			await assertDeploymentReadAccess(ctx, deployment);
			const logs = await readDeploymentLogTail(deployment, input.tail);
			return summarizeDeploymentObservation(deployment, { logs });
		}),

	follow: protectedProcedure
		.input(
			z.object({
				deploymentId: z.string().min(1),
				...observationOptionsSchema,
			}),
		)
		.query(async ({ input, ctx }) => {
			const initial = await findDeploymentById(input.deploymentId);
			await assertDeploymentReadAccess(ctx, initial);
			const result = await pollDeployment({
				load: () => findDeploymentById(input.deploymentId),
				isComplete: (deployment) => isDeploymentTerminal(deployment.status),
				timeoutMs: input.timeoutSeconds * 1000,
				pollIntervalMs: input.pollIntervalSeconds * 1000,
			});
			const deployment = result.deployment ?? initial;
			const logs = await readDeploymentLogTail(deployment, input.tail);
			return summarizeDeploymentObservation(deployment, {
				logs,
				timedOut: result.timedOut,
			});
		}),

	followLatest: protectedProcedure
		.input(
			z.object({
				type: z.enum(["application", "compose"]),
				id: z.string().min(1),
				afterDeploymentId: z.string().min(1).optional(),
				...observationOptionsSchema,
			}),
		)
		.query(async ({ input, ctx }) => {
			await checkServicePermissionAndAccess(ctx, input.id, {
				deployment: ["read"],
			});
			const result = await pollDeployment({
				load: () =>
					findLatestDeployment(input.type, input.id, input.afterDeploymentId),
				isComplete: (deployment) => isDeploymentTerminal(deployment.status),
				timeoutMs: input.timeoutSeconds * 1000,
				pollIntervalMs: input.pollIntervalSeconds * 1000,
			});
			if (!result.deployment) {
				return missingDeploymentObservation(
					input.afterDeploymentId
						? "No newer deployment was created before the observation window ended. Check that auto-deploy is enabled, the trigger is push, the pushed branch matches, and the provider webhook is connected."
						: "No deployment was created before the observation window ended.",
					result.timedOut,
				);
			}
			const logs = await readDeploymentLogTail(result.deployment, input.tail);
			return summarizeDeploymentObservation(result.deployment, {
				logs,
				timedOut: result.timedOut,
			});
		}),
	killProcess: protectedProcedure
		.input(
			z.object({
				deploymentId: z.string().min(1),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			const deployment = await findDeploymentById(input.deploymentId);
			const serviceId = deployment.applicationId || deployment.composeId;
			if (serviceId) {
				await checkServicePermissionAndAccess(ctx, serviceId, {
					deployment: ["cancel"],
				});
			} else if (deployment.schedule?.serverId) {
				const targetServer = await findServerById(deployment.schedule.serverId);
				if (targetServer.organizationId !== ctx.session.activeOrganizationId) {
					throw new TRPCError({
						code: "UNAUTHORIZED",
						message: "You don't have access to this deployment.",
					});
				}
			}

			if (!deployment.pid) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Deployment is not running",
				});
			}

			const command = `kill -9 ${deployment.pid}`;
			if (deployment.schedule?.serverId) {
				await execAsyncRemote(deployment.schedule.serverId, command);
			} else {
				await execAsync(command);
			}

			await updateDeploymentStatus(deployment.deploymentId, "error");
			await audit(ctx, {
				action: "cancel",
				resourceType: "deployment",
				resourceId: deployment.deploymentId,
			});
		}),

	removeDeployment: protectedProcedure
		.input(
			z.object({
				deploymentId: z.string().min(1),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			const deployment = await findDeploymentById(input.deploymentId);
			const serviceId = deployment.applicationId || deployment.composeId;
			if (serviceId) {
				await checkServicePermissionAndAccess(ctx, serviceId, {
					deployment: ["cancel"],
				});
			} else if (deployment.schedule?.serverId) {
				const targetServer = await findServerById(deployment.schedule.serverId);
				if (targetServer.organizationId !== ctx.session.activeOrganizationId) {
					throw new TRPCError({
						code: "UNAUTHORIZED",
						message: "You don't have access to this deployment.",
					});
				}
			}
			const result = await removeDeployment(input.deploymentId);
			await audit(ctx, {
				action: "delete",
				resourceType: "deployment",
				resourceId: deployment.deploymentId,
			});
			return result;
		}),

	readLogs: protectedProcedure
		.input(
			z.object({
				deploymentId: z.string().min(1),
				tail: z.number().int().min(1).max(10000).default(100),
			}),
		)
		.query(async ({ input, ctx }) => {
			const deployment = await findDeploymentById(input.deploymentId);
			await assertDeploymentReadAccess(ctx, deployment);
			return await readDeploymentLogTail(deployment, input.tail);
		}),
});
