import { standardSchemaResolver as zodResolver } from "@hookform/resolvers/standard-schema";
import { ArrowRightLeft, CheckCircle2, XCircle } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { AlertBlock } from "@/components/shared/alert-block";
import { DrawerLogs } from "@/components/shared/drawer-logs";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/utils/api";
import { type LogLine, parseLogs } from "../docker/logs/utils";

const TransferSchema = z.object({
	host: z.string().min(1, { message: "Host is required" }),
	port: z.number().min(1).max(65535),
	username: z.string().min(1, { message: "Username is required" }),
	privateKey: z.string().min(1, { message: "SSH private key is required" }),
});

export const TransferInstance = () => {
	const [isOpen, setIsOpen] = useState(false);
	const [isDrawerOpen, setIsDrawerOpen] = useState(false);
	const [filteredLogs, setFilteredLogs] = useState<LogLine[]>([]);
	const [isTransferring, setIsTransferring] = useState(false);

	const form = useForm({
		defaultValues: {
			host: "",
			port: 22,
			username: "root",
			privateKey: "",
		},
		resolver: zodResolver(TransferSchema),
	});

	const validateSource = api.transfer.validateSource.useMutation();
	const validation = validateSource.data;

	api.transfer.transferWithLogs.useSubscription(
		{
			host: form.watch("host"),
			port: form.watch("port"),
			username: form.watch("username"),
			privateKey: form.watch("privateKey"),
		},
		{
			enabled: isTransferring,
			onData(log) {
				if (!isDrawerOpen) {
					setIsDrawerOpen(true);
				}
				if (log === "Transfer completed successfully!") {
					setIsTransferring(false);
				}
				const parsedLogs = parseLogs(log);
				setFilteredLogs((prev) => [...prev, ...parsedLogs]);
			},
			onError(error) {
				console.error("Transfer logs error:", error);
				setIsTransferring(false);
			},
		},
	);

	const onTestConnection = async () => {
		const valid = await form.trigger();
		if (!valid) return;
		validateSource.mutate(form.getValues(), {
			onSuccess(data) {
				if (data.hasDokployDirectory && data.postgresRunning) {
					toast.success("Old server looks good — ready to transfer");
				} else {
					toast.error(
						"Connected, but the old server does not look like a working Dokploy installation",
					);
				}
			},
			onError(error) {
				toast.error(error.message);
			},
		});
	};

	const onSubmit = () => {
		setIsTransferring(true);
	};

	return (
		<div className="w-full">
			<Card className="h-full bg-sidebar p-2.5 rounded-xl mx-auto w-full">
				<div className="rounded-xl bg-background shadow-md">
					<CardHeader>
						<CardTitle className="text-xl flex flex-row gap-2">
							<ArrowRightLeft className="size-6 text-muted-foreground self-center" />
							Migrate From Another Server
						</CardTitle>
						<CardDescription>
							Transfer all data (projects, users, settings and configuration)
							from an old Dokploy server to this one over SSH.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4 py-6 border-t">
						<AlertBlock type="warning">
							This replaces everything on this server: the database and the
							/etc/dokploy directory. Applications keep running on the old
							server; after the transfer, redeploy them here and update your DNS
							records to point to this server.
						</AlertBlock>
						<Dialog open={isOpen} onOpenChange={setIsOpen}>
							<DialogTrigger asChild>
								<Button variant="outline">
									<ArrowRightLeft className="mr-2 size-4" />
									Transfer Data
								</Button>
							</DialogTrigger>
							<DialogContent className="sm:max-w-2xl">
								<DialogHeader>
									<DialogTitle className="flex items-center">
										<ArrowRightLeft className="mr-2 size-4" />
										Transfer From Old Server
									</DialogTitle>
									<DialogDescription>
										Enter the SSH connection details of your old Dokploy server.
										The user needs access to Docker and /etc/dokploy (usually
										root).
									</DialogDescription>
								</DialogHeader>

								<AlertBlock type="error">
									All current data on this server will be erased and replaced
									with the old server's data. You will be logged out and must
									sign in again with the credentials from your old server.
								</AlertBlock>

								<Form {...form}>
									<form
										id="hook-form-transfer-instance"
										onSubmit={form.handleSubmit(onSubmit)}
										className="grid w-full gap-4"
									>
										<div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
											<FormField
												control={form.control}
												name="host"
												render={({ field }) => (
													<FormItem className="sm:col-span-2">
														<FormLabel>Host</FormLabel>
														<FormControl>
															<Input
																placeholder="Old server IP or hostname"
																{...field}
															/>
														</FormControl>
														<FormMessage />
													</FormItem>
												)}
											/>
											<FormField
												control={form.control}
												name="port"
												render={({ field }) => (
													<FormItem>
														<FormLabel>SSH Port</FormLabel>
														<FormControl>
															<Input
																placeholder="22"
																{...field}
																onChange={(e) => {
																	const value = e.target.value;
																	if (value === "") {
																		field.onChange(0);
																	} else {
																		const number = Number.parseInt(value, 10);
																		if (!Number.isNaN(number)) {
																			field.onChange(number);
																		}
																	}
																}}
															/>
														</FormControl>
														<FormMessage />
													</FormItem>
												)}
											/>
										</div>
										<FormField
											control={form.control}
											name="username"
											render={({ field }) => (
												<FormItem>
													<FormLabel>Username</FormLabel>
													<FormControl>
														<Input placeholder="root" {...field} />
													</FormControl>
													<FormMessage />
												</FormItem>
											)}
										/>
										<FormField
											control={form.control}
											name="privateKey"
											render={({ field }) => (
												<FormItem>
													<FormLabel>SSH Private Key</FormLabel>
													<FormControl>
														<Textarea
															placeholder={
																"-----BEGIN OPENSSH PRIVATE KEY-----\n..."
															}
															className="min-h-32 font-mono text-xs"
															{...field}
														/>
													</FormControl>
													<FormMessage />
												</FormItem>
											)}
										/>

										{validation && (
											<div className="flex flex-col gap-1 text-sm">
												<span className="flex items-center gap-2">
													{validation.hasDokployDirectory ? (
														<CheckCircle2 className="size-4 text-green-500" />
													) : (
														<XCircle className="size-4 text-destructive" />
													)}
													/etc/dokploy directory found
												</span>
												<span className="flex items-center gap-2">
													{validation.postgresRunning ? (
														<CheckCircle2 className="size-4 text-green-500" />
													) : (
														<XCircle className="size-4 text-destructive" />
													)}
													Dokploy database running
												</span>
												{validation.dokployImage && (
													<span className="text-muted-foreground">
														Old server image: {validation.dokployImage}
													</span>
												)}
											</div>
										)}

										<DialogFooter className="gap-2">
											<Button
												type="button"
												variant="secondary"
												isLoading={validateSource.isPending}
												onClick={onTestConnection}
											>
												Test Connection
											</Button>
											<Button
												type="submit"
												variant="destructive"
												form="hook-form-transfer-instance"
												isLoading={isTransferring}
											>
												Start Transfer
											</Button>
										</DialogFooter>
									</form>
								</Form>

								<DrawerLogs
									isOpen={isDrawerOpen}
									onClose={() => {
										setIsDrawerOpen(false);
										setFilteredLogs([]);
										setIsTransferring(false);
									}}
									filteredLogs={filteredLogs}
								/>
							</DialogContent>
						</Dialog>
					</CardContent>
				</div>
			</Card>
		</div>
	);
};
