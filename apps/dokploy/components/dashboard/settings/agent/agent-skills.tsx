"use client";
import { BrainCircuit, Trash2 } from "lucide-react";
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

export const AgentSkills = () => {
	const utils = api.useUtils();
	const { data: agent } = api.agent.get.useQuery();
	const { data: skills } = api.agent.skills.useQuery(undefined, {
		enabled: !!agent,
	});
	const { mutateAsync: deleteSkill } = api.agent.deleteSkill.useMutation();

	const remove = async (skillId: string) => {
		try {
			await deleteSkill({ skillId });
			await utils.agent.skills.invalidate();
			toast.success("Skill deleted");
		} catch (error) {
			toast.error("Failed to delete skill", {
				description: error instanceof Error ? error.message : "Unknown error",
			});
		}
	};

	return (
		<Card className="w-full rounded-lg bg-sidebar p-2.5">
			<div className="rounded-xl bg-background shadow-md">
				<CardHeader>
					<CardTitle className="flex items-center gap-2 text-xl">
						<BrainCircuit className="size-5" />
						Agent skills
					</CardTitle>
					<CardDescription>
						Reusable procedures the agent loads only when needed. Teach one with
						<code>/learn &lt;workflow&gt;</code> in Telegram or chat, and invoke
						it later with <code>/skill-name</code>.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-2">
					{(skills ?? []).map((skill) => (
						<details key={skill.skillId} className="group rounded-lg border">
							<summary className="flex cursor-pointer list-none items-center gap-3 p-3">
								<div className="min-w-0 flex-1">
									<div className="flex flex-wrap items-center gap-2">
										<code className="text-sm">/{skill.name}</code>
										<Badge variant="outline">v{skill.version}</Badge>
										<Badge variant="secondary">{skill.origin}</Badge>
									</div>
									<p className="mt-1 text-xs text-muted-foreground">
										{skill.description} · used {skill.usageCount}×
									</p>
								</div>
								<DialogAction
									title={`Delete /${skill.name}?`}
									description="The agent will no longer be able to load this procedure."
									onClick={() => remove(skill.skillId)}
								>
									<Button
										variant="ghost"
										size="icon"
										className="size-8"
										onClick={(event) => event.stopPropagation()}
									>
										<Trash2 className="size-4" />
									</Button>
								</DialogAction>
							</summary>
							<pre className="max-h-80 overflow-auto whitespace-pre-wrap border-t bg-muted/30 p-3 text-xs">
								{skill.content}
							</pre>
						</details>
					))}
					{(skills ?? []).length === 0 && (
						<div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
							No learned skills yet. Finish a repeatable workflow, then ask the
							agent to remember it or use <code>/learn</code>.
						</div>
					)}
				</CardContent>
			</div>
		</Card>
	);
};
