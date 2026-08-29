"use client";
import { standardSchemaResolver as zodResolver } from "@hookform/resolvers/standard-schema";
import { Bot, Check, ChevronDown, Loader2 } from "lucide-react";
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
	Command,
	CommandEmpty,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
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
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { api } from "@/utils/api";

const Schema = z.object({
	name: z.string().min(1, { message: "Name is required" }),
	isEnabled: z.boolean(),
	aiId: z.string().optional(),
	model: z.string().optional(),
	instructions: z.string().optional(),
});

type Schema = z.infer<typeof Schema>;

export const AgentForm = () => {
	const { data: agent, refetch } = api.agent.get.useQuery();
	const { data: aiSettings } = api.ai.getAll.useQuery();
	const { mutateAsync: save, isPending: isSaving } =
		api.agent.save.useMutation();
	const utils = api.useUtils();
	const [modelPopoverOpen, setModelPopoverOpen] = useState(false);
	const [modelSearch, setModelSearch] = useState("");

	const form = useForm<Schema>({
		resolver: zodResolver(Schema),
		defaultValues: {
			name: "Dokploy Agent",
			isEnabled: false,
			aiId: "",
			model: "",
			instructions: "",
		},
	});

	useEffect(() => {
		if (agent) {
			form.reset({
				name: agent.name,
				isEnabled: agent.isEnabled,
				aiId: agent.aiId || "",
				model: agent.model || "",
				instructions: agent.instructions || "",
			});
		}
	}, [agent]);

	const enabledProviders = (aiSettings ?? []).filter(
		(provider) => provider.isEnabled,
	);
	const selectedAiId = form.watch("aiId");
	const selectedProvider = enabledProviders.find(
		(provider) => provider.aiId === selectedAiId,
	);

	const { data: models, isFetching: isLoadingModels } =
		api.ai.getModels.useQuery(
			{
				apiUrl: selectedProvider?.apiUrl ?? "",
				apiKey: selectedProvider?.apiKey ?? "",
			},
			{ enabled: !!selectedProvider?.apiUrl },
		);

	const onSubmit = async (data: Schema) => {
		try {
			await save({
				...data,
				aiId: data.aiId || null,
				model: data.model || null,
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
						here — deployments, backups, audit log.
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
												Master switch for the agent and every chat gateway.
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
											<FormLabel>Provider</FormLabel>
											<Select
												onValueChange={(value) => {
													field.onChange(value);
													// Models differ per provider; drop a stale override.
													form.setValue("model", "");
												}}
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
															{provider.name}
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
								name="model"
								render={({ field }) => {
									const selected = models?.find((m) => m.id === field.value);
									const filtered = (models ?? []).filter((model) =>
										model.id.toLowerCase().includes(modelSearch.toLowerCase()),
									);
									const display =
										field.value && !filtered.find((m) => m.id === field.value)
											? selected
												? [selected, ...filtered]
												: filtered
											: filtered;

									return (
										<FormItem>
											<FormLabel>Model</FormLabel>
											<Popover
												open={modelPopoverOpen}
												onOpenChange={setModelPopoverOpen}
											>
												<PopoverTrigger asChild disabled={!selectedProvider}>
													<FormControl>
														<Button
															variant="outline"
															className={cn(
																"w-full justify-between",
																!field.value && "text-muted-foreground",
															)}
														>
															{isLoadingModels
																? "Loading models..."
																: field.value ||
																	(selectedProvider
																		? `Provider default (${selectedProvider.model})`
																		: "Select a provider first")}
															<ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
														</Button>
													</FormControl>
												</PopoverTrigger>
												<PopoverContent className="w-[400px] p-0" align="start">
													<Command>
														<CommandInput
															placeholder="Search or type a custom model..."
															value={modelSearch}
															onValueChange={setModelSearch}
														/>
														<CommandList>
															<CommandEmpty>
																{modelSearch ? (
																	<button
																		type="button"
																		className="w-full cursor-pointer px-2 py-1.5 text-left text-sm hover:bg-accent"
																		onClick={() => {
																			field.onChange(modelSearch);
																			setModelPopoverOpen(false);
																			setModelSearch("");
																		}}
																	>
																		Use custom model: "{modelSearch}"
																	</button>
																) : (
																	"No models found."
																)}
															</CommandEmpty>
															<CommandItem
																value="__default__"
																onSelect={() => {
																	field.onChange("");
																	setModelPopoverOpen(false);
																	setModelSearch("");
																}}
															>
																<Check
																	className={cn(
																		"mr-2 h-4 w-4",
																		field.value ? "opacity-0" : "opacity-100",
																	)}
																/>
																Provider default
																{selectedProvider
																	? ` (${selectedProvider.model})`
																	: ""}
															</CommandItem>
															{display.map((model) => (
																<CommandItem
																	key={model.id}
																	value={model.id}
																	onSelect={() => {
																		field.onChange(model.id);
																		setModelPopoverOpen(false);
																		setModelSearch("");
																	}}
																>
																	<Check
																		className={cn(
																			"mr-2 h-4 w-4",
																			field.value === model.id
																				? "opacity-100"
																				: "opacity-0",
																		)}
																	/>
																	{model.id}
																</CommandItem>
															))}
														</CommandList>
													</Command>
												</PopoverContent>
											</Popover>
											<FormDescription>
												Fetched live from the provider. Leave on "Provider
												default" to follow the model set in Settings → AI.
											</FormDescription>
											<FormMessage />
										</FormItem>
									);
								}}
							/>

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
