import {
	ArrowDownIcon,
	ArrowUpIcon,
	Clock,
	Cpu,
	HardDrive,
	Loader2,
	MemoryStick,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { api } from "@/utils/api";
import { CPUChart } from "./cpu-chart";
import { DiskChart } from "./disk-chart";
import { MemoryChart } from "./memory-chart";
import { NetworkChart } from "./network-chart";

const REFRESH_INTERVALS = {
	"5000": "5 Seconds",
	"10000": "10 Seconds",
	"20000": "20 Seconds",
	"30000": "30 Seconds",
} as const;

const DATA_POINTS_OPTIONS = {
	"50": "50 points",
	"200": "200 points",
	"500": "500 points",
	"800": "800 points",
	"1200": "1200 points",
	"1600": "1600 points",
	"2000": "2000 points",
	all: "All points",
} as const;

interface SystemMetrics {
	cpu: string;
	cpuModel: string;
	cpuCores: number;
	cpuPhysicalCores: number;
	cpuSpeed: number;
	os: string;
	distro: string;
	kernel: string;
	arch: string;
	memUsed: string;
	memUsedGB: string;
	memTotal: string;
	uptime: number;
	diskUsed: string;
	totalDisk: string;
	networkIn: string;
	networkOut: string;
	timestamp: string;
}

interface Props {
	/** Remote server to read metrics from. Omit to read the Dokploy server. */
	serverId?: string;
	BASE_URL?: string;
	token?: string;
}

const usageColor = (pct: number) => {
	if (pct >= 85) return "bg-red-500";
	if (pct >= 60) return "bg-amber-500";
	return "bg-emerald-500";
};

const UsageBar = ({ value }: { value: number }) => {
	const pct = Math.min(100, Math.max(0, value || 0));
	return (
		<div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
			<div
				className={`h-full rounded-full transition-all duration-700 ${usageColor(pct)}`}
				style={{ width: `${pct}%` }}
			/>
		</div>
	);
};

export const ShowPaidMonitoring = ({ serverId, BASE_URL, token }: Props) => {
	const [historicalData, setHistoricalData] = useState<SystemMetrics[]>([]);
	const [metrics, setMetrics] = useState<SystemMetrics>({} as SystemMetrics);
	const [dataPoints, setDataPoints] =
		useState<keyof typeof DATA_POINTS_OPTIONS>("50");
	const [refreshInterval, setRefreshInterval] = useState<string>("5000");

	const {
		data,
		isLoading,
		error: queryError,
	} = api.server.getServerMetrics.useQuery(
		{
			serverId,
			url: BASE_URL,
			token,
			dataPoints,
		},
		{
			refetchInterval:
				dataPoints === "all" ? undefined : Number.parseInt(refreshInterval),
			enabled: true,
		},
	);

	useEffect(() => {
		setHistoricalData([]);
		setMetrics({} as SystemMetrics);
	}, [serverId, BASE_URL]);

	useEffect(() => {
		if (!data) return;

		const formattedData = data.map((metric: SystemMetrics) => ({
			timestamp: metric.timestamp,
			cpu: Number.parseFloat(metric.cpu),
			cpuModel: metric.cpuModel,
			cpuCores: metric.cpuCores,
			cpuPhysicalCores: metric.cpuPhysicalCores,
			cpuSpeed: metric.cpuSpeed,
			os: metric.os,
			distro: metric.distro,
			kernel: metric.kernel,
			arch: metric.arch,
			memUsed: Number.parseFloat(metric.memUsed),
			memUsedGB: Number.parseFloat(metric.memUsedGB),
			memTotal: Number.parseFloat(metric.memTotal),
			networkIn: Number.parseFloat(metric.networkIn),
			networkOut: Number.parseFloat(metric.networkOut),
			diskUsed: Number.parseFloat(metric.diskUsed),
			totalDisk: Number.parseFloat(metric.totalDisk),
			uptime: metric.uptime,
		}));

		// @ts-expect-error
		setHistoricalData(formattedData);
		// @ts-expect-error
		setMetrics(formattedData[formattedData.length - 1] || {});
	}, [data]);

	const formatUptime = (seconds: number): string => {
		const days = Math.floor(seconds / (24 * 60 * 60));
		const hours = Math.floor((seconds % (24 * 60 * 60)) / (60 * 60));
		const minutes = Math.floor((seconds % (60 * 60)) / 60);

		return `${days}d ${hours}h ${minutes}m`;
	};

	if (isLoading) {
		return (
			<div className="flex h-[400px] w-full items-center justify-center">
				<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
			</div>
		);
	}

	if (queryError) {
		return (
			<div className="flex min-h-[55vh] w-full items-center justify-center p-4">
				<div className="max-w-xl text-center">
					<p className="mb-2 text-base font-medium leading-none text-muted-foreground">
						Error fetching metrics{" "}
					</p>
					<p className="whitespace-pre-line text-sm text-destructive">
						{queryError instanceof Error
							? queryError.message
							: "Failed to fetch metrics, Please check your monitoring Instance is Configured correctly."}
					</p>
					{BASE_URL && (
						<p className="text-sm text-muted-foreground">URL: {BASE_URL}</p>
					)}
				</div>
			</div>
		);
	}

	return (
		<div className="space-y-4 pt-5 pb-10 w-full md:px-4">
			<div className="flex items-center justify-between flex-wrap	 gap-2">
				<div className="flex items-center gap-3">
					<h2 className="text-2xl font-bold tracking-tight">
						System Monitoring
					</h2>
					<span className="flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground">
						<span className="relative flex size-2 rounded-full bg-emerald-500">
							<span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-60" />
						</span>
						Live · every {Number.parseInt(refreshInterval) / 1000}s
					</span>
				</div>
				<div className="flex items-center gap-4 flex-wrap">
					<div>
						<span className="text-sm text-muted-foreground">Data points:</span>
						<Select
							value={dataPoints}
							onValueChange={(value: keyof typeof DATA_POINTS_OPTIONS) =>
								setDataPoints(value)
							}
						>
							<SelectTrigger className="w-[180px]">
								<SelectValue placeholder="Select points" />
							</SelectTrigger>
							<SelectContent>
								{Object.entries(DATA_POINTS_OPTIONS).map(([value, label]) => (
									<SelectItem key={value} value={value}>
										{label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					<div>
						<span className="text-sm text-muted-foreground">
							Refresh interval:
						</span>
						<Select
							value={refreshInterval}
							onValueChange={(value: keyof typeof REFRESH_INTERVALS) =>
								setRefreshInterval(value)
							}
						>
							<SelectTrigger className="w-[180px]">
								<SelectValue placeholder="Select interval" />
							</SelectTrigger>
							<SelectContent>
								{Object.entries(REFRESH_INTERVALS).map(([value, label]) => (
									<SelectItem key={value} value={value}>
										{label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
				</div>
			</div>

			{/* Stats Cards */}
			<div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
				<div className="rounded-xl border text-card-foreground shadow-xs p-6">
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-2">
							<Clock className="h-4 w-4 text-muted-foreground" />
							<h3 className="text-sm font-medium">Uptime</h3>
						</div>
					</div>
					<p className="mt-2 text-2xl font-bold">
						{formatUptime(metrics.uptime || 0)}
					</p>
					<div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
						<span className="flex items-center gap-1">
							<ArrowDownIcon className="size-3 text-emerald-500" />
							{Number(metrics.networkIn || 0).toFixed(1)} MB
						</span>
						<span className="flex items-center gap-1">
							<ArrowUpIcon className="size-3 text-blue-500" />
							{Number(metrics.networkOut || 0).toFixed(1)} MB
						</span>
						<span>network</span>
					</div>
				</div>

				<div className="rounded-xl border text-card-foreground shadow-xs p-6">
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-2">
							<Cpu className="h-4 w-4 text-muted-foreground" />
							<h3 className="text-sm font-medium">CPU Usage</h3>
						</div>
						<span className="text-xs text-muted-foreground">
							{metrics.cpuCores} threads
						</span>
					</div>
					<p className="mt-2 text-2xl font-bold">
						{Number(metrics.cpu || 0).toFixed(1)}%
					</p>
					<UsageBar value={Number(metrics.cpu)} />
				</div>

				<div className="rounded-xl border text-card-foreground bg-transparent shadow-xs p-6">
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-2">
							<MemoryStick className="h-4 w-4 text-muted-foreground" />
							<h3 className="text-sm font-medium">Memory Usage</h3>
						</div>
						<span className="text-xs text-muted-foreground">
							{Number(metrics.memUsed || 0).toFixed(0)}%
						</span>
					</div>
					<p className="mt-2 text-2xl font-bold">
						{metrics.memUsedGB}{" "}
						<span className="text-sm font-normal text-muted-foreground">
							/ {metrics.memTotal} GB
						</span>
					</p>
					<UsageBar value={Number(metrics.memUsed)} />
				</div>

				<div className="rounded-xl border text-card-foreground shadow-xs p-6">
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-2">
							<HardDrive className="h-4 w-4 text-muted-foreground" />
							<h3 className="text-sm font-medium">Disk Usage</h3>
						</div>
						<span className="text-xs text-muted-foreground">
							{metrics.totalDisk} GB total
						</span>
					</div>
					<p className="mt-2 text-2xl font-bold">
						{Number(metrics.diskUsed || 0).toFixed(1)}%
					</p>
					<UsageBar value={Number(metrics.diskUsed)} />
				</div>
			</div>

			{/* System Information */}
			<div className="rounded-lg border text-card-foreground shadow-xs p-6">
				<h3 className="text-lg font-medium mb-4">System Information</h3>
				<div className="grid gap-4 md:grid-cols-2">
					<div>
						<h4 className="text-sm font-medium text-muted-foreground">CPU</h4>
						<p className="mt-1">{metrics.cpuModel}</p>
						<p className="text-sm text-muted-foreground mt-1">
							{metrics.cpuPhysicalCores} Physical Cores ({metrics.cpuCores}{" "}
							Threads) @ {metrics.cpuSpeed}GHz
						</p>
					</div>
					<div>
						<h4 className="text-sm font-medium text-muted-foreground">
							Operating System
						</h4>
						<p className="mt-1">{metrics.distro}</p>
						<p className="text-sm text-muted-foreground mt-1">
							Kernel: {metrics.kernel} ({metrics.arch})
						</p>
					</div>
				</div>
			</div>

			{/* Charts Grid */}
			<div className="grid gap-4 grid-cols-1 md:grid-cols-1 xl:grid-cols-2">
				<CPUChart data={historicalData} />
				<MemoryChart data={historicalData} />
				<DiskChart data={metrics} />
				<NetworkChart data={historicalData} />
			</div>
		</div>
	);
};
