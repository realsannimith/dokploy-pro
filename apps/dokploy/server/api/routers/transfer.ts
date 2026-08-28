import { IS_CLOUD } from "@dokploy/server/constants";
import {
	transferFromRemoteInstance,
	validateTransferSource,
} from "@dokploy/server/utils/transfer";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, createTRPCRouter } from "@/server/api/trpc";
import { audit } from "@/server/api/utils/audit";

export const apiTransferSource = z.object({
	host: z.string().min(1, { message: "Host is required" }),
	port: z.number().min(1).max(65535).default(22),
	username: z.string().min(1, { message: "Username is required" }),
	privateKey: z.string().min(1, { message: "SSH private key is required" }),
});

export const transferRouter = createTRPCRouter({
	validateSource: adminProcedure
		.input(apiTransferSource)
		.mutation(async ({ input }) => {
			if (IS_CLOUD) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "Instance transfer is not available on cloud",
				});
			}
			try {
				return await validateTransferSource(input);
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message:
						error instanceof Error
							? error.message
							: "Error connecting to the old server",
					cause: error,
				});
			}
		}),

	transferWithLogs: adminProcedure
		.input(apiTransferSource)
		.subscription(async function* ({ input, ctx, signal }) {
			if (IS_CLOUD) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "Instance transfer is not available on cloud",
				});
			}
			await audit(ctx, {
				action: "restore",
				resourceType: "settings",
				resourceName: `transfer from ${input.host}`,
			});
			const queue: string[] = [];
			let done = false;
			const onLog = (log: string) => queue.push(log);
			transferFromRemoteInstance(input, onLog)
				.catch(() => {
					// The error was already emitted to the log stream.
				})
				.finally(() => {
					done = true;
				});
			while (!done || queue.length > 0) {
				if (queue.length > 0) {
					yield queue.shift()!;
				} else {
					await new Promise((r) => setTimeout(r, 50));
				}

				if (signal?.aborted) {
					return;
				}
			}
		}),
});
