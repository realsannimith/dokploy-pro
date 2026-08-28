import { AlertCircle, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props extends React.ComponentPropsWithoutRef<"div"> {
	icon?: React.ReactNode;
	type?: "info" | "success" | "warning" | "error";
}

const iconMap = {
	info: {
		className: "border-link/25 bg-link/8",
		iconClassName: "text-link",
		icon: Info,
	},
	success: {
		className: "border-brand-teal/30 bg-brand-teal/10",
		iconClassName: "text-brand-teal",
		icon: CheckCircle2,
	},
	warning: {
		className: "border-warning/30 bg-warning/10",
		iconClassName: "text-warning",
		icon: AlertCircle,
	},
	error: {
		className: "border-destructive/25 bg-destructive/8",
		iconClassName: "text-destructive",
		icon: AlertTriangle,
	},
};

export function AlertBlock({
	type = "info",
	icon,
	children,
	className,
	...props
}: Props) {
	const {
		className: blockClassName,
		iconClassName,
		icon: Icon,
	} = iconMap[type];
	return (
		<div
			{...props}
			className={cn(
				"flex flex-row items-start gap-3 rounded-lg border p-3",
				blockClassName,
				className,
			)}
		>
			<div className="shrink-0 mt-0.5">
				{icon || <Icon className={cn("size-4", iconClassName)} />}
			</div>
			<div className="flex-1 min-w-0">
				<span className="text-sm text-foreground wrap-break-word overflow-wrap-anywhere whitespace-pre-wrap">
					{children}
				</span>
			</div>
		</div>
	);
}
