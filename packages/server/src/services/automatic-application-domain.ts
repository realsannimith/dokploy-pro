import { isIP } from "node:net";
import { db } from "@dokploy/server/db";
import { applications, deployments, domains } from "@dokploy/server/db/schema";
import { getWebServerSettings } from "@dokploy/server/services/web-server-settings";
import { generateRandomDomain } from "@dokploy/server/templates";
import type { ApplicationNested } from "@dokploy/server/utils/builders";
import { getEnvironmentVariablesObject } from "@dokploy/server/utils/docker/utils";
import { manageDomain } from "@dokploy/server/utils/traefik/domain";
import { and, eq, sql } from "drizzle-orm";
import { findServerById } from "./server";

export type AutomaticApplicationDomainResult =
	| {
			status: "created";
			domain: typeof domains.$inferSelect;
	  }
	| {
			status: "skipped";
			reason: "domain-exists" | "missing-ip" | "previously-deployed";
	  };

export const getAutomaticApplicationDomainPort = (
	application: Pick<ApplicationNested, "buildType" | "env" | "environment">,
) => {
	if (application.buildType === "static") {
		return 80;
	}

	try {
		const environment = getEnvironmentVariablesObject(
			application.env,
			application.environment.project.env,
			application.environment.env,
		);
		const configuredPort = environment.PORT?.trim();
		if (configuredPort && /^\d+$/.test(configuredPort)) {
			const port = Number(configuredPort);
			if (Number.isSafeInteger(port) && port >= 1 && port <= 65_535) {
				return port;
			}
		}
	} catch {
		// Invalid or unresolved environment values should not block a deployment.
	}

	return 3000;
};

const resolveDeploymentIp = async (serverId: string | null) => {
	const rawIp = serverId
		? (await findServerById(serverId)).ipAddress
		: (await getWebServerSettings())?.serverIp;
	const ip = rawIp?.trim().replace(/^\[|\]$/g, "") || "";

	return isIP(ip) === 0 ? null : ip;
};

/**
 * Claims and creates the convenience domain for an application's first
 * successful normal deployment. The application row lock makes the domain
 * check and insert atomic across concurrent workers without a schema migration.
 */
export const ensureAutomaticApplicationDomain = async ({
	application,
}: {
	application: ApplicationNested;
}): Promise<AutomaticApplicationDomainResult> => {
	const serverIp = await resolveDeploymentIp(application.serverId);
	const port = getAutomaticApplicationDomainPort(application);
	const host = serverIp
		? generateRandomDomain({
				projectName: application.appName,
				serverIp,
			})
		: null;

	const result = await db.transaction<AutomaticApplicationDomainResult>(
		async (tx) => {
			await tx.execute(sql`
			select ${applications.applicationId}
			from ${applications}
			where ${applications.applicationId} = ${application.applicationId}
			for update
		`);

			const existingDomain = await tx.query.domains.findFirst({
				columns: { domainId: true },
				where: eq(domains.applicationId, application.applicationId),
			});
			if (existingDomain) {
				return { status: "skipped", reason: "domain-exists" };
			}

			const previousSuccessfulDeployment = await tx.query.deployments.findFirst(
				{
					columns: { deploymentId: true },
					where: and(
						eq(deployments.applicationId, application.applicationId),
						eq(deployments.status, "done"),
					),
				},
			);
			if (previousSuccessfulDeployment) {
				return { status: "skipped", reason: "previously-deployed" };
			}
			if (!host) {
				return { status: "skipped", reason: "missing-ip" };
			}

			const [domain] = await tx
				.insert(domains)
				.values({
					applicationId: application.applicationId,
					certificateType: "none",
					domainType: "application",
					host,
					https: false,
					path: "/",
					port,
				})
				.returning();

			if (!domain) {
				throw new Error("Automatic application domain was not created");
			}

			return { status: "created", domain };
		},
	);

	if (result.status === "created") {
		await manageDomain(application, result.domain);
	}

	return result;
};
