"use client";
import type { AgentToolCall } from "@dokploy/server/db/schema/agent";
import {
	Loader2,
	MessageSquare,
	Plus,
	Send,
	Trash2,
	Wrench,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { api } from "@/utils/api";

const SOURCE_LABELS: Record<string, string> = {
	telegram: "Telegram",
	discord: "Discord",
	slack: "Slack",
	whatsapp: "WhatsApp",
	signal: "Signal",
	email: "Email",
	web: "Web",
};

const parseToolCalls = (raw?: string | null): AgentToolCall[] => {
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
};

export const AgentChat = () => {
	const { data: agent } = api.agent.get.useQuery();
	const { data: conversations, refetch: refetchConversations } =
		api.agent.conversations.useQuery(undefined, {
			enabled: !!agent,
		});
	const [selectedId, setSelectedId] = useState<string | undefined>();
	const [input, setInput] = useState("");
	const [pendingMessage, setPendingMessage] = useState<string | null>(null);
	const bottomRef = useRef<HTMLDivElement | null>(null);

	const { data: messages, refetch: refetchMessages } =
		api.agent.messages.useQuery(
			{ conversationId: selectedId || "" },
			{ enabled: !!selectedId },
		);

	const { mutateAsync: chat, isPending: isChatting } =
		api.agent.chat.useMutation();
	const { mutateAsync: removeConversation } =
		api.agent.deleteConversation.useMutation();

	useEffect(() => {
		bottomRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [messages, pendingMessage]);

	if (!agent) {
		return null;
	}

	const sendMessage = async () => {
		const message = input.trim();
		if (!message || isChatting) return;
		setInput("");
		setPendingMessage(message);
		try {
			const result = await chat({
				message,
				conversationId: selectedId,
			});
			setSelectedId(result.conversationId);
			await Promise.all([refetchMessages(), refetchConversations()]);
		} catch (error) {
			toast.error("Agent error", {
				description: error instanceof Error ? error.message : "Unknown error",
			});
		} finally {
			setPendingMessage(null);
		}
	};

	const handleDelete = async (conversationId: string) => {
		try {
			await removeConversation({ conversationId });
			if (selectedId === conversationId) {
				setSelectedId(undefined);
			}
			await refetchConversations();
			toast.success("Conversation deleted");
		} catch {
			toast.error("Failed to delete conversation");
		}
	};

	return (
		<Card className="rounded-lg w-full bg-sidebar p-2.5">
			<div className="rounded-xl bg-background shadow-md">
				<CardHeader>
					<CardTitle className="text-xl flex items-center gap-2">
						<MessageSquare className="size-5" />
						Conversations
					</CardTitle>
					<CardDescription>
						Talk to the agent here, and review everything it has done from
						Telegram — including which tools it called.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="grid md:grid-cols-[240px_1fr] gap-4 min-h-[420px]">
						<div className="flex flex-col gap-2 border rounded-lg p-2">
							<Button
								variant="outline"
								size="sm"
								onClick={() => setSelectedId(undefined)}
							>
								<Plus className="size-4" />
								New chat
							</Button>
							<ScrollArea className="h-[380px]">
								<div className="flex flex-col gap-1">
									{(conversations ?? []).map((conversation) => (
										<div
											key={conversation.conversationId}
											className={cn(
												"group flex items-center justify-between gap-1 rounded-md px-2 py-1.5 text-sm cursor-pointer hover:bg-accent",
												selectedId === conversation.conversationId &&
													"bg-accent",
											)}
											onClick={() => setSelectedId(conversation.conversationId)}
										>
											<div className="flex flex-col overflow-hidden">
												<span className="truncate">
													{conversation.title || "Untitled"}
												</span>
												<span className="text-xs text-muted-foreground">
													{SOURCE_LABELS[conversation.source] ??
														conversation.source}{" "}
													· {new Date(conversation.updatedAt).toLocaleString()}
												</span>
											</div>
											<DialogAction
												title="Delete conversation"
												description="This removes the conversation and its messages."
												onClick={() =>
													handleDelete(conversation.conversationId)
												}
											>
												<Button
													variant="ghost"
													size="icon"
													className="size-6 opacity-0 group-hover:opacity-100"
													onClick={(event) => event.stopPropagation()}
												>
													<Trash2 className="size-3.5" />
												</Button>
											</DialogAction>
										</div>
									))}
									{(conversations ?? []).length === 0 && (
										<span className="text-xs text-muted-foreground px-2 py-4 text-center">
											No conversations yet.
										</span>
									)}
								</div>
							</ScrollArea>
						</div>

						<div className="flex flex-col border rounded-lg">
							<ScrollArea className="flex-1 h-[380px] p-4">
								<div className="flex flex-col gap-3">
									{(messages ?? []).map((message) => {
										const toolCalls = parseToolCalls(message.toolCalls);
										return (
											<div
												key={message.messageId}
												className={cn(
													"flex flex-col gap-1 max-w-[85%]",
													message.role === "user"
														? "self-end items-end"
														: "self-start items-start",
												)}
											>
												{toolCalls.length > 0 && (
													<div className="flex flex-wrap gap-1">
														{toolCalls.map((toolCall, index) => (
															<Badge
																key={index}
																variant="outline"
																className="text-xs gap-1"
																title={JSON.stringify(toolCall.input, null, 2)}
															>
																<Wrench className="size-3" />
																{toolCall.toolName}
															</Badge>
														))}
													</div>
												)}
												<div
													className={cn(
														"rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words",
														message.role === "user"
															? "bg-primary text-primary-foreground"
															: "bg-muted",
													)}
												>
													{message.content}
												</div>
											</div>
										);
									})}
									{pendingMessage && (
										<>
											<div className="self-end max-w-[85%] rounded-lg px-3 py-2 text-sm bg-primary text-primary-foreground whitespace-pre-wrap">
												{pendingMessage}
											</div>
											<div className="self-start flex items-center gap-2 text-sm text-muted-foreground px-3 py-2">
												<Loader2 className="size-4 animate-spin" />
												Working…
											</div>
										</>
									)}
									{!selectedId &&
										!pendingMessage &&
										(messages ?? []).length === 0 && (
											<span className="text-sm text-muted-foreground text-center py-10">
												Start a new chat — try “What projects do I have?”
											</span>
										)}
									<div ref={bottomRef} />
								</div>
							</ScrollArea>
							<div className="border-t p-2 flex gap-2">
								<Input
									value={input}
									onChange={(event) => setInput(event.target.value)}
									onKeyDown={(event) => {
										if (event.key === "Enter" && !event.shiftKey) {
											event.preventDefault();
											void sendMessage();
										}
									}}
									placeholder={
										agent.isEnabled
											? "Ask the agent something…"
											: "Enable the agent first to chat"
									}
									disabled={!agent.isEnabled || isChatting}
								/>
								<Button
									onClick={() => void sendMessage()}
									disabled={!agent.isEnabled || isChatting || !input.trim()}
									size="icon"
								>
									{isChatting ? (
										<Loader2 className="size-4 animate-spin" />
									) : (
										<Send className="size-4" />
									)}
								</Button>
							</div>
						</div>
					</div>
				</CardContent>
			</div>
		</Card>
	);
};
