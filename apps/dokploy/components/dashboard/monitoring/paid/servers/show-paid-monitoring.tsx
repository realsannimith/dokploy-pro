import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { api } from "@/utils/api";
import { CPUChart } from "./cpu-chart";
import { DiskChart } from "./disk-chart";
import { MemoryChart } from "./memory-chart";
import { NetworkChart } from "./network-chart";

const REFRESH_INTERVALS = {
	"5000": "5s",
	"10000": "10s",
	"20000": "20s",
	"30000": "30s",
} as const;

const DATA_POINTS_OPTIONS = {
	"50": "50 pts",
	"200": "200 pts",
	"500": "500 pts",
	"800": "800 pts",
	"1200": "1.2k pts",
	"1600": "1.6k pts",
	"2000": "2k pts",
	all: "All pts",
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

const barColor = (pct: number) => {
	if (pct >= 85) return "bg-destructive";
	if (pct >= 60) return "bg-warning";
	return "bg-link";
};

interface StatProps {
	label: string;
	value: string;
	unit?: string;
	meta?: string;
	percent?: number;
}

const Stat = ({ label, value, unit, meta, percent }: StatProps) => {
	const pct = Math.min(100, Math.max(0, percent ?? 0));

	return (
		<div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5 shadow-xs">
			<span className="eyebrow">{label}</span>
			<div className="flex items-baseline gap-1">
				<span className="text-3xl font-semibold tracking-display tabular-nums">
					{value}
				</span>
				{unit && <span className="text-sm text-muted-foreground">{unit}</span>}
			</div>
			{percent === undefined ? (
				<span className="font-mono text-xs text-muted-foreground">{meta}</span>
			) : (
				<div className="flex flex-col gap-1.5">
					<div className="h-1 w-full overflow-hidden rounded-full bg-secondary">
						<div
							className={cn(
								"h-full rounded-full transition-all duration-700",
								barColor(pct),
							)}
							style={{ width: `${pct}%` }}
						/>
					</div>
					<span className="font-mono text-xs text-muted-foreground">
						{meta}
					</span>
				</div>
			)}
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

		if (days > 0) return `${days}d ${hours}h`;
		if (hours > 0) return `${hours}h ${minutes}m`;
		return `${minutes}m`;
	};

	if (isLoading) {
		return (
			<div className="flex h-[400px] w-full items-center justify-center">
				<Loader2 className="size-5 animate-spin text-muted-foreground" />
			</div>
		);
	}

	if (queryError) {
		return (
			<div className="flex min-h-[40vh] w-full flex-col items-center justify-center gap-2 rounded-xl border border-border bg-card p-6 text-center">
				<p className="text-sm font-medium">Metrics unavailable</p>
				<p className="max-w-md whitespace-pre-line font-mono text-xs text-destructive">
					{queryError instanceof Error
						? queryError.message
						: "Could not reach the monitoring instance."}
				</p>
				{BASE_URL && (
					<p className="font-mono text-xs text-muted-foreground">{BASE_URL}</p>
				)}
			</div>
		);
	}

	const systemLine = [
		metrics.distro,
		metrics.kernel && `${metrics.kernel} · ${metrics.arch}`,
		metrics.cpuModel,
	]
		.filter(Boolean)
		.join("  ·  ");

	return (
		<div className="flex w-full flex-col gap-4">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<span className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
					<span className="relative flex size-1.5 rounded-full bg-brand-teal">
						<span className="absolute inline-flex size-full animate-ping rounded-full bg-brand-teal opacity-60" />
					</span>
					Live
				</span>
				<div className="flex items-center gap-2">
					<Select
						value={dataPoints}
						onValueChange={(value: keyof typeof DATA_POINTS_OPTIONS) =>
							setDataPoints(value)
						}
					>
						<SelectTrigger size="sm" className="w-[7rem]">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{Object.entries(DATA_POINTS_OPTIONS).map(([value, label]) => (
								<SelectItem key={value} value={value}>
									{label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>

					<Select
						value={refreshInterval}
						onValueChange={(value: keyof typeof REFRESH_INTERVALS) =>
							setRefreshInterval(value)
						}
					>
						<SelectTrigger size="sm" className="w-[5.5rem]">
							<SelectValue />
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

			<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
				<Stat
					label="CPU"
					value={Number(metrics.cpu || 0).toFixed(1)}
					unit="%"
					percent={Number(metrics.cpu || 0)}
					meta={`${metrics.cpuCores ?? 0} threads`}
				/>
				<Stat
					label="Memory"
					value={String(metrics.memUsedGB ?? 0)}
					unit={`/ ${metrics.memTotal ?? 0} GB`}
					percent={Number(metrics.memUsed || 0)}
					meta={`${Number(metrics.memUsed || 0).toFixed(0)}% used`}
				/>
				<Stat
					label="Disk"
					value={Number(metrics.diskUsed || 0).toFixed(1)}
					unit="%"
					percent={Number(metrics.diskUsed || 0)}
					meta={`${metrics.totalDisk ?? 0} GB total`}
				/>
				<Stat
					label="Uptime"
					value={formatUptime(metrics.uptime || 0)}
					meta={`↓ ${Number(metrics.networkIn || 0).toFixed(1)} · ↑ ${Number(
						metrics.networkOut || 0,
					).toFixed(1)} MB`}
				/>
			</div>

			{systemLine && (
				<p className="truncate font-mono text-xs text-muted-foreground">
					{systemLine}
				</p>
			)}

			<div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
				<CPUChart data={historicalData} />
				<MemoryChart data={historicalData} />
				<DiskChart data={metrics} />
				<NetworkChart data={historicalData} />
			</div>
		</div>
	);
};
