import { IS_CLOUD } from "@dokploy/server/constants";
import { validateRequest } from "@dokploy/server/lib/auth";
import { hasPermission } from "@dokploy/server/services/permission";
import {
	ActivityIcon,
	HomeIcon,
	Loader2,
	ServerIcon,
	TerminalIcon,
} from "lucide-react";
import type { GetServerSidePropsContext } from "next";
import Link from "next/link";
import { type ReactElement, useState } from "react";
import { ContainerFreeMonitoring } from "@/components/dashboard/monitoring/free/container/show-free-container-monitoring";
import { ShowPaidMonitoring } from "@/components/dashboard/monitoring/paid/servers/show-paid-monitoring";
import { TerminalModal } from "@/components/dashboard/settings/web-server/terminal-modal";
import { DashboardLayout } from "@/components/layouts/dashboard-layout";
import { AlertBlock } from "@/components/shared/alert-block";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { api } from "@/utils/api";

const DOKPLOY_SERVER = "dokploy-server";

// Escape hatch for local development, where the metrics container is usually
// reachable on localhost instead of the configured server IP.
const DEV_METRICS_URL = process.env.NEXT_PUBLIC_METRICS_URL;
const DEV_METRICS_TOKEN = process.env.NEXT_PUBLIC_METRICS_TOKEN;

interface ServerCardProps {
	name: string;
	subtitle: string;
	isSelected: boolean;
	monitoringEnabled: boolean;
	isDokploy?: boolean;
	onSelect: () => void;
}

const ServerCard = ({
	name,
	subtitle,
	isSelected,
	monitoringEnabled,
	isDokploy,
	onSelect,
}: ServerCardProps) => {
	return (
		<button
			type="button"
			onClick={onSelect}
			className={cn(
				"group relative flex min-w-[190px] flex-col gap-2 rounded-xl border bg-background p-4 text-left transition-all hover:shadow-md",
				isSelected
					? "border-primary ring-2 ring-primary/30 shadow-md"
					: "hover:border-primary/40",
			)}
		>
			<div className="flex items-center gap-2">
				<div
					className={cn(
						"flex size-8 shrink-0 items-center justify-center rounded-lg",
						isSelected
							? "bg-primary text-primary-foreground"
							: "bg-muted text-muted-foreground",
					)}
				>
					{isDokploy ? (
						<HomeIcon className="size-4" />
					) : (
						<ServerIcon className="size-4" />
					)}
				</div>
				<div className="min-w-0">
					<p className="truncate text-sm font-semibold">{name}</p>
					<p className="truncate text-xs text-muted-foreground">{subtitle}</p>
				</div>
			</div>
			<div className="flex items-center gap-1.5">
				<span
					className={cn(
						"relative flex size-2 shrink-0 rounded-full",
						monitoringEnabled ? "bg-emerald-500" : "bg-amber-500",
					)}
				>
					{monitoringEnabled && (
						<span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-60" />
					)}
				</span>
				<span className="text-xs text-muted-foreground">
					{monitoringEnabled ? "Metrics active" : "Metrics off"}
				</span>
			</div>
		</button>
	);
};

const Dashboard = () => {
	const [selectedServer, setSelectedServer] = useState(DOKPLOY_SERVER);

	const { data: monitoring, isPending } = api.user.getMetricsToken.useQuery();
	const { data: servers, isPending: isPendingServers } =
		api.server.monitoringTargets.useQuery();
	const { data: user } = api.user.get.useQuery();

	const isAdmin = user?.role === "owner" || user?.role === "admin";

	const isDokployServer = selectedServer === DOKPLOY_SERVER;
	const remoteServer = servers?.find((s) => s.serverId === selectedServer);

	const isDokployMonitoringEnabled =
		Boolean(DEV_METRICS_URL) ||
		Boolean(monitoring?.metricsConfig?.server?.token);

	const selectedName = isDokployServer
		? "Dokploy Server"
		: (remoteServer?.name ?? "Unknown server");

	// The local terminal is owner/admin-only server-side; remote terminals
	// follow the accessible-servers check the targets query already applies.
	const terminalServerId = isDokployServer
		? isAdmin
			? "local"
			: null
		: remoteServer?.hasSshKey
			? remoteServer.serverId
			: null;

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
					<ActivityIcon className="size-8 text-muted-foreground" />
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
						<div className="flex flex-wrap items-start justify-between gap-4">
							<div className="space-y-1">
								<h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
									<ActivityIcon className="size-6 text-muted-foreground" />
									Monitoring
								</h1>
								<p className="text-sm text-muted-foreground">
									Watch the resource usage of the Dokploy server and every
									remote server you have connected.
								</p>
							</div>
							<div className="flex items-center gap-2">
								<Badge variant="outline" className="gap-1.5">
									<ServerIcon className="size-3" />
									{(servers?.length ?? 0) + 1} servers
								</Badge>
								{terminalServerId && (
									<TerminalModal serverId={terminalServerId} asButton>
										<Button variant="outline" size="sm" className="gap-2">
											<TerminalIcon className="size-4" />
											Terminal · {selectedName}
										</Button>
									</TerminalModal>
								)}
							</div>
						</div>

						<div className="flex gap-3 overflow-x-auto pb-1">
							<ServerCard
								name="Dokploy Server"
								subtitle="Main dashboard host"
								isSelected={isDokployServer}
								monitoringEnabled={isDokployMonitoringEnabled}
								isDokploy
								onSelect={() => setSelectedServer(DOKPLOY_SERVER)}
							/>
							{servers?.map((server) => (
								<ServerCard
									key={server.serverId}
									name={server.name}
									subtitle={server.ipAddress}
									isSelected={selectedServer === server.serverId}
									monitoringEnabled={server.monitoringEnabled}
									onSelect={() => setSelectedServer(server.serverId)}
								/>
							))}
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
