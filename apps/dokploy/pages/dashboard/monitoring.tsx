import { IS_CLOUD } from "@dokploy/server/constants";
import { validateRequest } from "@dokploy/server/lib/auth";
import { hasPermission } from "@dokploy/server/services/permission";
import { HomeIcon, Loader2, ServerIcon, TerminalIcon } from "lucide-react";
import type { GetServerSidePropsContext } from "next";
import Link from "next/link";
import { type ReactElement, useState } from "react";
import { toast } from "sonner";
import { ContainerFreeMonitoring } from "@/components/dashboard/monitoring/free/container/show-free-container-monitoring";
import { ShowPaidMonitoring } from "@/components/dashboard/monitoring/paid/servers/show-paid-monitoring";
import { TerminalModal } from "@/components/dashboard/settings/web-server/terminal-modal";
import { DashboardLayout } from "@/components/layouts/dashboard-layout";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { api } from "@/utils/api";

const DOKPLOY_SERVER = "dokploy-server";

// Escape hatch for local development, where the metrics container is usually
// reachable on localhost instead of the configured server IP.
const DEV_METRICS_URL = process.env.NEXT_PUBLIC_METRICS_URL;

interface ServerTabProps {
	name: string;
	isSelected: boolean;
	live: boolean;
	isDokploy?: boolean;
	onSelect: () => void;
}

const ServerTab = ({
	name,
	isSelected,
	live,
	isDokploy,
	onSelect,
}: ServerTabProps) => (
	<button
		type="button"
		onClick={onSelect}
		className={cn(
			"inline-flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
			isSelected
				? "border-foreground bg-foreground text-background"
				: "border-border bg-background text-muted-foreground hover:bg-secondary hover:text-foreground",
		)}
	>
		{isDokploy ? (
			<HomeIcon className="size-3.5" />
		) : (
			<ServerIcon className="size-3.5" />
		)}
		<span className="max-w-[14rem] truncate">{name}</span>
		<span
			className={cn(
				"size-1.5 rounded-full",
				live ? "bg-brand-teal" : "bg-warning",
			)}
		/>
	</button>
);

const EmptyState = ({
	title,
	href,
	action,
}: {
	title: string;
	href: string;
	action: string;
}) => (
	<div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 rounded-xl border border-border bg-card">
		<p className="text-sm text-muted-foreground">{title}</p>
		<Button asChild size="sm">
			<Link href={href}>{action}</Link>
		</Button>
	</div>
);

const Dashboard = () => {
	const [selectedServer, setSelectedServer] = useState(DOKPLOY_SERVER);

	const { data: monitoring, isPending } = api.user.getMetricsToken.useQuery();
	const {
		data: servers,
		isPending: isPendingServers,
		refetch: refetchServers,
	} = api.server.monitoringTargets.useQuery();
	const { data: user } = api.user.get.useQuery();
	const { data: permissions } = api.user.getPermissions.useQuery();
	const enableMonitoring = api.server.enableMonitoring.useMutation({
		onSuccess: async () => {
			toast.success(
				"Monitoring enabled — the first metrics can take a minute to appear.",
			);
			await refetchServers();
		},
		onError: (error) => {
			toast.error(error.message);
		},
	});

	const isAdmin = user?.role === "owner" || user?.role === "admin";

	const isDokployServer = selectedServer === DOKPLOY_SERVER;
	const remoteServer = servers?.find((s) => s.serverId === selectedServer);

	const isDokployMonitoringEnabled =
		Boolean(DEV_METRICS_URL) || Boolean(monitoring?.monitoringEnabled);

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
						<div className="rounded-xl border border-border bg-secondary/50 px-4 py-3 text-sm text-muted-foreground">
							Server metrics are off — showing container usage.{" "}
							<Link
								href="/dashboard/settings/server"
								className="font-medium text-link hover:underline"
							>
								Enable metrics
							</Link>
						</div>
						<ContainerFreeMonitoring appName="dokploy" showHeader={false} />
					</div>
				);
			}

			return <ShowPaidMonitoring />;
		}

		if (!remoteServer) {
			return (
				<EmptyState
					title="This server is no longer available."
					href="/dashboard/settings/servers"
					action="Manage servers"
				/>
			);
		}

		if (!remoteServer.monitoringEnabled) {
			if (permissions?.server.create) {
				return (
					<div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 rounded-xl border border-border bg-card">
						<p className="text-sm text-muted-foreground">
							Monitoring is off on {remoteServer.name}.
						</p>
						<div className="flex items-center gap-2">
							<Button
								size="sm"
								isLoading={enableMonitoring.isPending}
								onClick={() =>
									enableMonitoring.mutate({
										serverId: remoteServer.serverId,
									})
								}
							>
								Enable monitoring
							</Button>
							<Button asChild size="sm" variant="outline">
								<Link href="/dashboard/settings/servers">
									Configure manually
								</Link>
							</Button>
						</div>
						<p className="max-w-md px-4 text-center text-xs text-muted-foreground">
							This deploys the monitoring agent on {remoteServer.name} with
							default settings — the same metrics the Dokploy server shows. You
							can fine-tune it later in Setup Server → Monitoring.
						</p>
					</div>
				);
			}
			return (
				<EmptyState
					title={`Monitoring is off on ${remoteServer.name}.`}
					href="/dashboard/settings/servers"
					action="Set up monitoring"
				/>
			);
		}

		return <ShowPaidMonitoring serverId={remoteServer.serverId} />;
	};

	if (isPending || isPendingServers) {
		return (
			<div className="flex min-h-[60vh] items-center justify-center">
				<Loader2 className="size-5 animate-spin text-muted-foreground" />
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-6 pb-10">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<p className="eyebrow">Monitoring</p>
					<h1 className="display-md">Servers</h1>
				</div>
				{terminalServerId && (
					<TerminalModal serverId={terminalServerId} asButton>
						<Button variant="outline" size="sm">
							<TerminalIcon />
							Terminal
						</Button>
					</TerminalModal>
				)}
			</div>

			<div className="flex gap-2 overflow-x-auto pb-1">
				<ServerTab
					name="Dokploy"
					isSelected={isDokployServer}
					live={isDokployMonitoringEnabled}
					isDokploy
					onSelect={() => setSelectedServer(DOKPLOY_SERVER)}
				/>
				{servers?.map((server) => (
					<ServerTab
						key={server.serverId}
						name={server.name}
						isSelected={selectedServer === server.serverId}
						live={server.monitoringEnabled}
						onSelect={() => setSelectedServer(server.serverId)}
					/>
				))}
			</div>

			{renderContent()}
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
