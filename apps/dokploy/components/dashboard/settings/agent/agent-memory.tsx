"use client";
import { DatabaseZap, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { DialogAction } from "@/components/shared/dialog-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { api } from "@/utils/api";

export const AgentMemory = () => {
	const utils = api.useUtils();
	const { data: agent } = api.agent.get.useQuery();
	const { data: memories } = api.agent.memories.useQuery(undefined, {
		enabled: !!agent,
	});
	const { mutateAsync: deleteMemory } = api.agent.deleteMemory.useMutation();

	const remove = async (key: string) => {
		try {
			await deleteMemory({ key });
			await utils.agent.memories.invalidate();
			toast.success("Memory forgotten");
		} catch (error) {
			toast.error("Failed to forget memory", {
				description: error instanceof Error ? error.message : "Unknown error",
			});
		}
	};

	return (
		<Card className="w-full rounded-lg bg-sidebar p-2.5">
			<div className="rounded-xl bg-background shadow-md">
				<CardHeader>
					<CardTitle className="flex items-center gap-2 text-xl">
						<DatabaseZap className="size-5" />
						Persistent memory
					</CardTitle>
					<CardDescription>
						Small durable facts and preferences available in every session. Long
						procedures belong in Agent skills; credentials are never stored
						here.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-2">
					{(memories ?? []).map((memory) => (
						<div
							key={memory.memoryId}
							className="flex items-start gap-3 rounded-lg border p-3"
						>
							<div className="min-w-0 flex-1">
								<div className="flex flex-wrap items-center gap-2">
									<code className="text-sm">{memory.key}</code>
									<Badge variant="secondary">{memory.origin}</Badge>
								</div>
								<p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
									{memory.content}
								</p>
							</div>
							<DialogAction
								title={`Forget ${memory.key}?`}
								description="This fact will no longer be included in future agent sessions."
								onClick={() => remove(memory.key)}
							>
								<Button variant="ghost" size="icon" className="size-8">
									<Trash2 className="size-4" />
								</Button>
							</DialogAction>
						</div>
					))}
					{(memories ?? []).length === 0 && (
						<div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
							No durable memories yet. Tell the agent to remember a stable
							preference or convention.
						</div>
					)}
				</CardContent>
			</div>
		</Card>
	);
};
