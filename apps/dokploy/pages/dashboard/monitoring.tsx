import { IS_CLOUD } from "@dokploy/server/constants";
import { validateRequest } from "@dokploy/server/lib/auth";
import { hasPermission } from "@dokploy/server/services/permission";
import { Loader2, ServerIcon } from "lucide-react";
import type { GetServerSidePropsContext } from "next";
import Link from "next/link";
import { type ReactElement, useState } from "react";
import { ContainerFreeMonitoring } from "@/components/dashboard/monitoring/free/container/show-free-container-monitoring";
import { ShowPaidMonitoring } from "@/components/dashboard/monitoring/paid/servers/show-paid-monitoring";
import { DashboardLayout } from "@/components/layouts/dashboard-layout";
import { AlertBlock } from "@/components/shared/alert-block";
import { Card } from "@/components/ui/card";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { api } from "@/utils/api";

const DOKPLOY_SERVER = "dokploy-server";

// Escape hatch for local development, where the metrics container is usually
// reachable on localhost instead of the configured server IP.
const DEV_METRICS_URL = process.env.NEXT_PUBLIC_METRICS_URL;
const DEV_METRICS_TOKEN = process.env.NEXT_PUBLIC_METRICS_TOKEN;

const Dashboard = () => {
	const [selectedServer, setSelectedServer] = useState(DOKPLOY_SERVER);

	const { data: monitoring, isPending } = api.user.getMetricsToken.useQuery();
	const { data: servers, isPending: isPendingServers } =
		api.server.monitoringTargets.useQuery();

	const isDokployServer = selectedServer === DOKPLOY_SERVER;
	const remoteServer = servers?.find((s) => s.serverId === selectedServer);

	const isDokployMonitoringEnabled =
		Boolean(DEV_METRICS_URL) ||
		Boolean(monitoring?.metricsConfig?.server?.token);

	const renderContent = () => {
		if (isDokployServer) {
			if (!isDokployMonitoringEnabled) {
				return (
					<div className="flex flex-col gap-4">
						<AlertBlock>
							Server metrics are not enabled on the Dokploy server. Enable them
							in{" "}
							<Link
								href="/dashboard/settings/server"
								className="underline font-medium"
							>
								Settings {">"} Server {">"} Monitoring
							</Link>{" "}
							to see CPU, memory, disk and network history. Meanwhile you are
							watching the Dokploy container usage.
						</AlertBlock>
						<ContainerFreeMonitoring appName="dokploy" showHeader={false} />
					</div>
				);
			}

			return (
				<ShowPaidMonitoring
					BASE_URL={DEV_METRICS_URL}
					token={DEV_METRICS_TOKEN}
				/>
			);
		}

		if (!remoteServer) {
			return (
				<div className="flex min-h-[35vh] flex-col items-center justify-center gap-3 text-muted-foreground">
					<ServerIcon className="size-8" />
					<span className="text-base">
						This server is no longer available. Pick another one.
					</span>
				</div>
			);
		}

		if (!remoteServer.monitoringEnabled) {
			return (
				<div className="flex min-h-[35vh] flex-col items-center justify-center gap-3 text-center">
					<ServerIcon className="size-8 text-muted-foreground" />
					<span className="text-base text-muted-foreground max-w-lg">
						Monitoring is not enabled on <strong>{remoteServer.name}</strong>.
						Open{" "}
						<Link
							href="/dashboard/settings/servers"
							className="text-primary underline"
						>
							Settings {">"} Servers
						</Link>
						, click <strong>Setup Server</strong> and save the{" "}
						<strong>Monitoring</strong> tab to deploy the metrics service on it.
					</span>
				</div>
			);
		}

		return <ShowPaidMonitoring serverId={remoteServer.serverId} />;
	};

	return (
		<div className="space-y-4 pb-10">
			{isPending || isPendingServers ? (
				<Card className="bg-sidebar  p-2.5 rounded-xl  mx-auto  items-center">
					<div className="rounded-xl bg-background flex shadow-md px-4 w-full min-h-[50vh] justify-center items-center text-muted-foreground">
						Loading... <Loader2 className="h-4 w-4 animate-spin" />
					</div>
				</Card>
			) : (
				<Card className="h-full bg-sidebar  p-2.5 rounded-xl">
					<div className="rounded-xl bg-background shadow-md p-6 flex flex-col gap-6">
						<div className="flex flex-wrap items-center justify-between gap-4">
							<div className="space-y-1">
								<h1 className="text-2xl font-semibold tracking-tight">
									Monitoring
								</h1>
								<p className="text-sm text-muted-foreground">
									Watch the resource usage of the Dokploy server and every
									remote server you have connected.
								</p>
							</div>
							<div className="flex flex-col gap-1">
								<span className="text-sm text-muted-foreground">Server</span>
								<Select
									value={selectedServer}
									onValueChange={setSelectedServer}
								>
									<SelectTrigger className="w-[280px]">
										<SelectValue placeholder="Select a server" />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value={DOKPLOY_SERVER}>
											Dokploy Server
										</SelectItem>
										{servers?.map((server) => (
											<SelectItem key={server.serverId} value={server.serverId}>
												<span className="flex items-center gap-2">
													{server.name}
													<span className="text-muted-foreground text-xs">
														{server.ipAddress}
														{!server.monitoringEnabled && " · metrics off"}
													</span>
												</span>
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						</div>
						{renderContent()}
					</div>
				</Card>
			)}
		</div>
	);
};

export default Dashboard;

Dashboard.getLayout = (page: ReactElement) => {
	return <DashboardLayout>{page}</DashboardLayout>;
};
export async function getServerSideProps(
	ctx: GetServerSidePropsContext<{ serviceId: string }>,
) {
	if (IS_CLOUD) {
		return {
			redirect: {
				permanent: false,
				destination: "/dashboard/home",
			},
		};
	}
	const { user, session } = await validateRequest(ctx.req);
	if (!user) {
		return {
			redirect: {
				permanent: false,
				destination: "/",
			},
		};
	}

	const canView = await hasPermission(
		{
			user: { id: user.id },
			session: { activeOrganizationId: session?.activeOrganizationId || "" },
		},
		{ monitoring: ["read"] },
	);

	if (!canView) {
		return {
			redirect: {
				permanent: false,
				destination: "/dashboard/home",
			},
		};
	}

	return {
		props: {},
	};
}
