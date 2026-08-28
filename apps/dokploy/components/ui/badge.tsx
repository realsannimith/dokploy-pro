import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
	"group/badge inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-4xl border border-transparent px-2.5 py-0.5 text-xs font-medium whitespace-nowrap transition-all focus-visible:ring-2 focus-visible:ring-ring/60 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg:not(.cursor-pointer)]:pointer-events-none [&>svg]:size-3!",
	{
		variants: {
			variant: {
				default: "bg-primary text-primary-foreground [a]:hover:bg-primary/85",
				secondary:
					"bg-secondary text-muted-foreground [a]:hover:bg-secondary/70",
				destructive:
					"bg-destructive/10 text-destructive focus-visible:ring-destructive/20 dark:bg-destructive/15 [a]:hover:bg-destructive/20",
				outline:
					"border-border text-foreground [a]:hover:bg-secondary [a]:hover:text-foreground",
				ghost: "hover:bg-secondary hover:text-foreground",
				link: "text-link underline-offset-4 hover:underline",
				red: "h-4 rounded-md border-transparent bg-destructive/10 px-1 py-1 text-xs font-medium whitespace-nowrap text-destructive select-none dark:bg-destructive/15",
				yellow:
					"h-4 rounded-md border-transparent bg-warning/15 px-1 py-1 text-xs font-medium whitespace-nowrap text-warning select-none",
				orange:
					"h-4 rounded-md border-transparent bg-brand-coral/15 px-1 py-1 text-xs font-medium whitespace-nowrap text-brand-coral select-none",
				green:
					"h-4 rounded-md border-transparent bg-brand-teal/15 px-1 py-1 text-xs font-medium whitespace-nowrap text-brand-teal select-none",
				blue: "h-4 rounded-md border-transparent bg-link/12 px-1 py-1 text-xs font-medium whitespace-nowrap text-link select-none",
				blank:
					"h-4 rounded-md border-transparent bg-secondary px-1 py-1 text-xs font-medium whitespace-nowrap text-muted-foreground select-none",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	},
);

function Badge({
	className,
	variant = "default",
	asChild = false,
	...props
}: React.ComponentProps<"span"> &
	VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
	const Comp = asChild ? Slot.Root : "span";

	return (
		<Comp
			data-slot="badge"
			data-variant={variant}
			className={cn(badgeVariants({ variant }), className)}
			{...props}
		/>
	);
}

export { Badge, badgeVariants };
