"use client";
import { standardSchemaResolver as zodResolver } from "@hookform/resolvers/standard-schema";
import { Bot, ExternalLink, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { AlertBlock } from "@/components/shared/alert-block";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Form,
	FormControl,
	FormDescription,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/utils/api";

const Schema = z.object({
	name: z.string().min(1, { message: "Name is required" }),
	isEnabled: z.boolean(),
	aiId: z.string().optional(),
	instructions: z.string().optional(),
	telegramEnabled: z.boolean(),
	telegramBotToken: z.string().optional(),
	telegramAllowedUserIds: z.string().optional(),
});

type Schema = z.infer<typeof Schema>;

export const AgentForm = () => {
	const { data: agent, refetch } = api.agent.get.useQuery();
	const { data: aiSettings } = api.ai.getAll.useQuery();
	const { mutateAsync: save, isPending: isSaving } =
		api.agent.save.useMutation();
	const { mutateAsync: testBot, isPending: isTesting } =
		api.agent.testTelegramBot.useMutation();
	const utils = api.useUtils();
	const [botInfo, setBotInfo] = useState<{
		username: string;
		name: string;
	} | null>(null);

	const form = useForm<Schema>({
		resolver: zodResolver(Schema),
		defaultValues: {
			name: "Dokploy Agent",
			isEnabled: false,
			aiId: "",
			instructions: "",
			telegramEnabled: false,
			telegramBotToken: "",
			telegramAllowedUserIds: "",
		},
	});

	useEffect(() => {
		if (agent) {
			form.reset({
				name: agent.name,
				isEnabled: agent.isEnabled,
				aiId: agent.aiId || "",
				instructions: agent.instructions || "",
				telegramEnabled: agent.telegramEnabled,
				telegramBotToken: agent.telegramBotToken || "",
				telegramAllowedUserIds: agent.telegramAllowedUserIds || "",
			});
		}
	}, [agent]);

	const enabledProviders = (aiSettings ?? []).filter(
		(provider) => provider.isEnabled,
	);

	const onSubmit = async (data: Schema) => {
		try {
			await save({
				...data,
				aiId: data.aiId || null,
			});
			await utils.agent.get.invalidate();
			toast.success("Agent settings saved");
			refetch();
		} catch (error) {
			toast.error("Failed to save agent settings", {
				description: error instanceof Error ? error.message : "Unknown error",
			});
		}
	};

	const handleTestBot = async () => {
		const token = form.getValues("telegramBotToken");
		if (!token) {
			toast.error("Enter a bot token first");
			return;
		}
		try {
			const info = await testBot({ token });
			setBotInfo(info);
			toast.success(`Connected to @${info.username}`);
		} catch (error) {
			setBotInfo(null);
			toast.error("Could not connect to Telegram", {
				description: error instanceof Error ? error.message : "Unknown error",
			});
		}
	};

	return (
		<Card className="rounded-lg w-full bg-sidebar p-2.5">
			<div className="rounded-xl bg-background shadow-md">
				<CardHeader>
					<CardTitle className="text-xl flex items-center gap-2">
						<Bot className="size-5" />
						AI Agent
					</CardTitle>
					<CardDescription>
						An assistant that manages this Dokploy instance through chat. It
						uses the same API as the dashboard, so everything it does shows up
						here — deployments, backups, audit log. Connect it to Telegram or
						talk to it from the playground below.
					</CardDescription>
				</CardHeader>
				<CardContent>
					{enabledProviders.length === 0 && (
						<AlertBlock type="warning" className="mb-4">
							No AI provider is configured. Add one in Settings → AI first — the
							agent needs a model to think with.
						</AlertBlock>
					)}
					<Form {...form}>
						<form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
							<FormField
								control={form.control}
								name="isEnabled"
								render={({ field }) => (
									<FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
										<div className="space-y-0.5">
											<FormLabel>Enable agent</FormLabel>
											<FormDescription>
												Master switch for the agent and all its gateways.
											</FormDescription>
										</div>
										<FormControl>
											<Switch
												checked={field.value}
												onCheckedChange={field.onChange}
											/>
										</FormControl>
									</FormItem>
								)}
							/>
							<div className="grid md:grid-cols-2 gap-4">
								<FormField
									control={form.control}
									name="name"
									render={({ field }) => (
										<FormItem>
											<FormLabel>Name</FormLabel>
											<FormControl>
												<Input placeholder="Dokploy Agent" {...field} />
											</FormControl>
											<FormMessage />
										</FormItem>
									)}
								/>
								<FormField
									control={form.control}
									name="aiId"
									render={({ field }) => (
										<FormItem>
											<FormLabel>AI Provider</FormLabel>
											<Select
												onValueChange={field.onChange}
												value={field.value}
											>
												<FormControl>
													<SelectTrigger>
														<SelectValue placeholder="Select a provider" />
													</SelectTrigger>
												</FormControl>
												<SelectContent>
													{enabledProviders.map((provider) => (
														<SelectItem
															key={provider.aiId}
															value={provider.aiId}
														>
															{provider.name} ({provider.model})
														</SelectItem>
													))}
												</SelectContent>
											</Select>
											<FormDescription>
												Configured in Settings → AI.
											</FormDescription>
											<FormMessage />
										</FormItem>
									)}
								/>
							</div>
							<FormField
								control={form.control}
								name="instructions"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Custom instructions (optional)</FormLabel>
										<FormControl>
											<Textarea
												rows={3}
												placeholder="e.g. Always answer in Khmer. Never stop the production project without double confirmation."
												{...field}
											/>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>

							<div className="rounded-lg border p-4 flex flex-col gap-4">
								<FormField
									control={form.control}
									name="telegramEnabled"
									render={({ field }) => (
										<FormItem className="flex flex-row items-center justify-between">
											<div className="space-y-0.5">
												<FormLabel>Telegram gateway</FormLabel>
												<FormDescription>
													Talk to the agent from Telegram. Create a bot with
													@BotFather, paste its token here.
												</FormDescription>
											</div>
											<FormControl>
												<Switch
													checked={field.value}
													onCheckedChange={field.onChange}
												/>
											</FormControl>
										</FormItem>
									)}
								/>
								<div className="grid md:grid-cols-2 gap-4">
									<FormField
										control={form.control}
										name="telegramBotToken"
										render={({ field }) => (
											<FormItem>
												<FormLabel>Bot token</FormLabel>
												<FormControl>
													<Input
														type="password"
														placeholder="123456789:AA..."
														{...field}
													/>
												</FormControl>
												<FormMessage />
											</FormItem>
										)}
									/>
									<FormField
										control={form.control}
										name="telegramAllowedUserIds"
										render={({ field }) => (
											<FormItem>
												<FormLabel>Allowed Telegram users</FormLabel>
												<FormControl>
													<Input
														placeholder="123456789, @myusername"
														{...field}
													/>
												</FormControl>
												<FormDescription>
													Comma-separated Telegram user IDs or @usernames.
													Anyone else is rejected. Message the bot once to see
													your ID.
												</FormDescription>
												<FormMessage />
											</FormItem>
										)}
									/>
								</div>
								<div className="flex items-center gap-3">
									<Button
										type="button"
										variant="outline"
										onClick={handleTestBot}
										disabled={isTesting}
									>
										{isTesting && <Loader2 className="size-4 animate-spin" />}
										Test bot connection
									</Button>
									{botInfo && (
										<a
											href={`https://t.me/${botInfo.username}`}
											target="_blank"
											rel="noreferrer"
											className="text-sm text-primary flex items-center gap-1"
										>
											@{botInfo.username} <ExternalLink className="size-3.5" />
										</a>
									)}
								</div>
							</div>

							<div className="flex justify-end">
								<Button type="submit" disabled={isSaving}>
									{isSaving && <Loader2 className="size-4 animate-spin" />}
									Save
								</Button>
							</div>
						</form>
					</Form>
				</CardContent>
			</div>
		</Card>
	);
};
