import { createWriteStream } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IS_CLOUD, paths } from "@dokploy/server/constants";
import {
	deriveKeysFromSecrets,
	ENCRYPTION_KEY_BACKUP_FILE,
} from "@dokploy/server/lib/encryption";
import { Client } from "ssh2";
import { execAsync } from "../process/execAsync";

export interface TransferSource {
	host: string;
	port: number;
	username: string;
	privateKey: string;
}

export interface TransferSourceValidation {
	hasDokployDirectory: boolean;
	postgresRunning: boolean;
	dokployImage: string | null;
}

const REMOTE_TRANSFER_DIR = "/tmp/dokploy-instance-transfer";

const FIND_POSTGRES_CONTAINER = `docker ps --filter "name=dokploy-postgres" --filter "status=running" -q | head -n 1`;
const FIND_DOKPLOY_CONTAINER = `docker ps --filter "label=com.docker.swarm.service.name=dokploy" --filter "status=running" -q | head -n 1`;

const connectToSource = (source: TransferSource) =>
	new Promise<Client>((resolve, reject) => {
		const client = new Client();
		client
			.once("ready", () => resolve(client))
			.once("error", (err) => {
				client.end();
				if (err.level === "client-authentication") {
					reject(
						new Error(
							`Authentication failed: Invalid SSH private key. ❌ Error: ${err.message}`,
						),
					);
				} else {
					reject(new Error(`SSH connection error: ${err.message}`));
				}
			})
			.connect({
				host: source.host,
				port: source.port,
				username: source.username,
				privateKey: source.privateKey,
				readyTimeout: 30000,
			});
	});

const execOnSource = (client: Client, command: string) =>
	new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
		client.exec(command, (err, stream) => {
			if (err) {
				reject(err);
				return;
			}
			let stdout = "";
			let stderr = "";
			stream
				.on("close", (code: number) => {
					if (code === 0) {
						resolve({ stdout, stderr });
					} else {
						reject(
							new Error(
								`Remote command failed (exit ${code}): ${stderr || stdout}`,
							),
						);
					}
				})
				.on("data", (data: Buffer) => {
					stdout += data.toString();
				});
			stream.stderr.on("data", (data: Buffer) => {
				stderr += data.toString();
			});
		});
	});

const downloadFromSource = (
	client: Client,
	remotePath: string,
	localPath: string,
) =>
	new Promise<number>((resolve, reject) => {
		client.exec(`cat ${remotePath}`, (err, stream) => {
			if (err) {
				reject(err);
				return;
			}
			const file = createWriteStream(localPath);
			let stderr = "";
			let bytes = 0;
			let exitCode: number | null = null;
			let settled = false;
			const fail = (error: Error) => {
				if (!settled) {
					settled = true;
					reject(error);
				}
			};
			const finish = () => {
				if (settled || exitCode === null || !file.closed) return;
				settled = true;
				if (exitCode === 0) {
					resolve(bytes);
				} else {
					reject(
						new Error(
							`Failed to download archive (exit ${exitCode}): ${stderr}`,
						),
					);
				}
			};
			stream.on("data", (data: Buffer) => {
				bytes += data.length;
			});
			stream.stderr.on("data", (data: Buffer) => {
				stderr += data.toString();
			});
			stream.on("close", (code: number) => {
				exitCode = code ?? 1;
				finish();
			});
			stream.on("error", fail);
			file.on("error", fail);
			file.on("close", finish);
			stream.pipe(file);
		});
	});

const formatBytes = (bytes: number) => {
	if (bytes === 0) return "0 B";
	const sizes = ["B", "KB", "MB", "GB", "TB"];
	const i = Math.floor(Math.log(bytes) / Math.log(1024));
	return `${(bytes / 1024 ** i).toFixed(2)} ${sizes[i]}`;
};

export const validateTransferSource = async (
	source: TransferSource,
): Promise<TransferSourceValidation> => {
	const client = await connectToSource(source);
	try {
		const { stdout } = await execOnSource(
			client,
			`
			if [ -d "/etc/dokploy" ]; then hasDir=true; else hasDir=false; fi
			postgresId=$(${FIND_POSTGRES_CONTAINER})
			if [ -n "$postgresId" ]; then postgresRunning=true; else postgresRunning=false; fi
			dokployImage=$(docker service inspect dokploy --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}' 2>/dev/null | cut -d'@' -f1)
			echo "{\\"hasDokployDirectory\\": $hasDir, \\"postgresRunning\\": $postgresRunning, \\"dokployImage\\": \\"$dokployImage\\"}"
			`,
		);
		const parsed = JSON.parse(stdout.trim());
		return {
			hasDokployDirectory: !!parsed.hasDokployDirectory,
			postgresRunning: !!parsed.postgresRunning,
			dokployImage: parsed.dokployImage || null,
		};
	} finally {
		client.end();
	}
};

const collectSourceEncryptionKeys = async (
	client: Client,
	emit: (log: string) => void,
) => {
	const keys = new Set<string>();
	try {
		const { stdout: appContainer } = await execOnSource(
			client,
			FIND_DOKPLOY_CONTAINER,
		);
		const appContainerId = appContainer.trim().split("\n")[0];
		if (appContainerId) {
			const { stdout: secretsOut } = await execOnSource(
				client,
				`docker exec ${appContainerId} sh -c 'printf "%s\\n%s\\n" "$ENCRYPTION_KEY" "$BETTER_AUTH_SECRET"'`,
			);
			const [encryptionKey, betterAuthSecret] = secretsOut.split("\n");
			for (const key of deriveKeysFromSecrets([
				encryptionKey,
				betterAuthSecret,
			])) {
				keys.add(key);
			}
		}
		// The old instance may itself hold restored keys from an even older one.
		const { stdout: oldKeyFile } = await execOnSource(
			client,
			`cat /etc/dokploy/${ENCRYPTION_KEY_BACKUP_FILE} 2>/dev/null || true`,
		);
		for (const line of oldKeyFile.split("\n")) {
			const trimmed = line.trim();
			if (/^[0-9a-f]{64}$/i.test(trimmed)) {
				keys.add(trimmed);
			}
		}
		if (keys.size) {
			emit("Collected encryption keys from the old server");
		} else {
			emit(
				"Warning: no encryption secrets found on the old server. If it stored encrypted credentials, you may need to re-enter them after the transfer.",
			);
		}
	} catch (error) {
		emit(
			`Warning: could not read encryption secrets from the old server (${
				error instanceof Error ? error.message : String(error)
			}). Stored credentials may need to be re-entered after the transfer.`,
		);
	}
	return keys;
};

export const transferFromRemoteInstance = async (
	source: TransferSource,
	emit: (log: string) => void,
) => {
	if (IS_CLOUD) {
		return;
	}
	const { BASE_PATH } = paths();
	emit(`Connecting to ${source.username}@${source.host}:${source.port}...`);
	const client = await connectToSource(source);
	const tempDir = await mkdtemp(join(tmpdir(), "dokploy-transfer-"));
	const archivePath = join(tempDir, "transfer.tar.gz");
	try {
		emit("Connected. Checking the old server...");
		await execOnSource(client, `[ -d "/etc/dokploy" ]`).catch(() => {
			throw new Error(
				"/etc/dokploy not found on the old server. Is Dokploy installed there?",
			);
		});
		const { stdout: remotePostgres } = await execOnSource(
			client,
			FIND_POSTGRES_CONTAINER,
		);
		const remotePostgresId = remotePostgres.trim().split("\n")[0];
		if (!remotePostgresId) {
			throw new Error(
				"Dokploy postgres container not found running on the old server",
			);
		}

		emit("Creating database dump on the old server...");
		await execOnSource(
			client,
			`rm -rf ${REMOTE_TRANSFER_DIR} && mkdir -p ${REMOTE_TRANSFER_DIR}`,
		);
		await execOnSource(
			client,
			`docker exec ${remotePostgresId} pg_dump -Fc -U dokploy -d dokploy -f /tmp/dokploy-transfer.sql`,
		);
		await execOnSource(
			client,
			`docker cp ${remotePostgresId}:/tmp/dokploy-transfer.sql ${REMOTE_TRANSFER_DIR}/database.sql`,
		);
		await execOnSource(
			client,
			`docker exec ${remotePostgresId} rm -f /tmp/dokploy-transfer.sql`,
		);
		emit("Database dump created");

		emit("Packaging /etc/dokploy on the old server...");
		// tar exits 1 on "file changed as we read it" warnings, which are
		// expected on a live server; only exit codes above 1 are fatal.
		await execOnSource(
			client,
			`tar -czf ${REMOTE_TRANSFER_DIR}/transfer.tar.gz --exclude='dokploy/volume-backups' --exclude='dokploy/${ENCRYPTION_KEY_BACKUP_FILE}' -C ${REMOTE_TRANSFER_DIR} database.sql -C /etc dokploy || [ $? -eq 1 ]`,
		);

		const encryptionKeys = await collectSourceEncryptionKeys(client, emit);

		emit("Downloading archive to this server...");
		const bytes = await downloadFromSource(
			client,
			`${REMOTE_TRANSFER_DIR}/transfer.tar.gz`,
			archivePath,
		);
		emit(`Downloaded ${formatBytes(bytes)}`);

		emit("Cleaning up temporary files on the old server...");
		await execOnSource(client, `rm -rf ${REMOTE_TRANSFER_DIR}`);
		client.end();

		emit("Extracting archive...");
		await execAsync(`tar -xzf "${archivePath}" -C "${tempDir}"`);
		const { stdout: hasSqlFile } = await execAsync(
			`ls ${tempDir}/database.sql || true`,
		);
		if (!hasSqlFile.includes("database.sql")) {
			throw new Error("Database dump not found in the transferred archive");
		}
		const { stdout: hasFilesystem } = await execAsync(
			`ls -d ${tempDir}/dokploy || true`,
		);
		if (!hasFilesystem.includes("dokploy")) {
			throw new Error("Filesystem data not found in the transferred archive");
		}

		const { stdout: localPostgres } = await execAsync(FIND_POSTGRES_CONTAINER);
		const localPostgresId = localPostgres.trim();
		if (!localPostgresId) {
			throw new Error("Dokploy postgres container not found on this server");
		}

		emit("Replacing /etc/dokploy with the transferred filesystem...");
		await execAsync(`rm -rf "${BASE_PATH}/"*`);
		await execAsync(`mkdir -p "${BASE_PATH}"`);
		await execAsync(`cp -rp "${tempDir}/dokploy/." "${BASE_PATH}/"`);

		if (encryptionKeys.size) {
			await writeFile(
				join(BASE_PATH, ENCRYPTION_KEY_BACKUP_FILE),
				[...encryptionKeys].join("\n"),
				{ mode: 0o600 },
			);
			emit("Wrote encryption key fallback file");
		}

		emit(
			"Restoring database... You will be logged out when this finishes; sign in again with the credentials from your old server.",
		);
		await execAsync(
			`docker exec ${localPostgresId} psql -U dokploy postgres -c "SELECT pg_terminate_backend(pg_stat_activity.pid) FROM pg_stat_activity WHERE pg_stat_activity.datname = 'dokploy' AND pid <> pg_backend_pid();"`,
		);
		await execAsync(
			`docker exec ${localPostgresId} psql -U dokploy postgres -c "DROP DATABASE IF EXISTS dokploy;"`,
		);
		await execAsync(
			`docker exec ${localPostgresId} psql -U dokploy postgres -c "CREATE DATABASE dokploy;"`,
		);
		await execAsync(
			`docker cp ${tempDir}/database.sql ${localPostgresId}:/tmp/database.sql`,
		);
		await execAsync(
			`docker exec ${localPostgresId} pg_restore -v -U dokploy -d dokploy /tmp/database.sql`,
		);
		await execAsync(`docker exec ${localPostgresId} rm -f /tmp/database.sql`);

		emit("Transfer completed successfully!");
		emit(
			"Dokploy will restart in ~10 seconds to apply database migrations. Refresh this page afterwards and sign in with your old credentials.",
		);
		await execAsync(
			`nohup sh -c 'sleep 10 && (docker service update --force dokploy || docker restart dokploy)' > /dev/null 2>&1 &`,
		);
	} catch (error) {
		try {
			await execOnSource(client, `rm -rf ${REMOTE_TRANSFER_DIR}`);
		} catch {
			// Connection may already be closed.
		}
		client.end();
		emit(
			`Error: ${
				error instanceof Error
					? error.message
					: "Error transferring data from the old server"
			}`,
		);
		throw error;
	} finally {
		await rm(tempDir, { recursive: true, force: true }).catch(() => {});
	}
};
