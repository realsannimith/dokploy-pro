import { db } from "@dokploy/server/db";
import { member } from "@dokploy/server/db/schema";
import { and, eq } from "drizzle-orm";
import { appRouter } from "@/server/api/root";

/**
 * Builds a tRPC caller for the user the agent acts as, mirroring the shape
 * `validateRequest` produces for API-key auth. Every agent tool call goes
 * through the same procedures (permissions, audit log, deployment queue)
 * as the dashboard.
 */
export const createAgentCaller = async (
	userId: string,
	organizationId: string,
) => {
	const memberResult = await db.query.member.findFirst({
		where: and(
			eq(member.userId, userId),
			eq(member.organizationId, organizationId),
		),
		with: {
			organization: true,
			user: true,
		},
	});

	if (!memberResult) {
		throw new Error(
			"The agent user is no longer a member of this organization",
		);
	}

	const reqStub = {
		headers: {},
		socket: { remoteAddress: "127.0.0.1" },
	};

	const ctx = {
		db,
		req: reqStub as any,
		res: {} as any,
		session: {
			userId,
			activeOrganizationId: organizationId,
		} as any,
		user: {
			...memberResult.user,
			id: memberResult.user.id,
			name: memberResult.user.firstName,
			role: memberResult.role as "owner" | "admin" | "member",
			ownerId: memberResult.organization.ownerId,
			enableEnterpriseFeatures: memberResult.user.enableEnterpriseFeatures,
			isValidEnterpriseLicense: memberResult.user.isValidEnterpriseLicense,
		} as any,
	};

	return appRouter.createCaller(ctx as any);
};

export type AgentCaller = Awaited<ReturnType<typeof createAgentCaller>>;
