import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { docker, execAsync, IS_CLOUD, paths } from "@dokploy/server";

const LOCAL_SERVER_USERNAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_.-]{0,31}\$?$/;

const AUTHORIZE_LOCAL_SSH_KEY_SCRIPT = String.raw`
set -eu

passwd_entry="$(awk -F: -v target="$TARGET_USER" '$1 == target { print $6 ":" $3 ":" $4; exit }' /host/etc/passwd)"
if [ -z "$passwd_entry" ]; then
	echo "The configured local user does not exist on the Docker host." >&2
	exit 2
fi

user_home="$(printf '%s' "$passwd_entry" | cut -d: -f1)"
user_uid="$(printf '%s' "$passwd_entry" | cut -d: -f2)"
user_gid="$(printf '%s' "$passwd_entry" | cut -d: -f3)"

case "$user_home" in
	/*) ;;
	*) echo "The configured local user has an invalid home directory." >&2; exit 3 ;;
esac
case "$user_home/" in
	*/../*) echo "The configured local user has an unsafe home directory." >&2; exit 3 ;;
esac

ssh_dir="/host$user_home/.ssh"
authorized_keys="$ssh_dir/authorized_keys"
public_key="$(cat /host/etc/dokploy/ssh/auto_generated-dokploy-local.pub)"

mkdir -p "$ssh_dir"
touch "$authorized_keys"
if ! grep -qxF "$public_key" "$authorized_keys"; then
	printf '%s\n' "$public_key" >> "$authorized_keys"
fi

chmod 700 "$ssh_dir"
chmod 600 "$authorized_keys"
chown "$user_uid:$user_gid" "$ssh_dir" "$authorized_keys"
`;

/**
 * Validates that the container ID matches Docker's expected format.
 * Docker container IDs are 64-character hex strings (or 12-char short form).
 * Also allows container names: alphanumeric, underscores, hyphens, and dots.
 */
export const isValidContainerId = (id: string): boolean => {
	// Match full ID (64 hex chars), short ID (12 hex chars), or container name
	const hexPattern = /^[a-f0-9]{12,64}$/i;
	const namePattern = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
	return hexPattern.test(id) || (namePattern.test(id) && id.length <= 128);
};

/**
 * Local terminal usernames are passed to SSH and to the host-key authorization
 * helper. Keep the accepted format to normal Linux account names so the value
 * can never become a path or command fragment.
 */
export const isValidLocalServerUsername = (username: string): boolean =>
	LOCAL_SERVER_USERNAME_PATTERN.test(username);

/**
 * Validates the `tail` parameter for docker logs (number of lines, max 10000).
 * Prevents command injection by allowing only digits.
 */
export const isValidTail = (tail: string): boolean => {
	return (
		/^\d+$/.test(tail) &&
		Number.parseInt(tail, 10) <= 10000 &&
		Number.parseInt(tail, 10) >= 0
	);
};

/**
 * Validates the `since` parameter for docker logs: "all" or duration like 5s, 10m, 1h, 2d.
 * Prevents command injection by allowing only a strict format.
 */
export const isValidSince = (since: string): boolean => {
	return since === "all" || /^\d+[smhd]$/.test(since);
};

/**
 * Validates the `search` parameter for log filtering.
 * Search is concatenated into shell commands (SSH path: double quotes; local path: single quotes).
 * Only allow alphanumeric, space, dot, underscore, hyphen to prevent $, `, ', " from enabling command injection.
 * Max length 500.
 */
export const isValidSearch = (search: string): boolean => {
	// Space only (not \s) to reject \n, \r, \t and other control chars
	return /^[a-zA-Z0-9 ._-]{0,500}$/.test(search);
};

/**
 * Validates that the shell is one of the allowed shells.
 */
export const isValidShell = (shell: string): boolean => {
	const allowedShells = [
		"sh",
		"bash",
		"zsh",
		"ash",
		"/bin/sh",
		"/bin/bash",
		"/bin/zsh",
		"/bin/ash",
	];
	return allowedShells.includes(shell);
};

/**
 * Clamps cols/rows read from the client's initial connection query params
 * to a sane range, falling back to the standard 80x24 default.
 */
export const parseTerminalSize = (
	colsParam: string | null,
	rowsParam: string | null,
) => {
	const cols = Number(colsParam);
	const rows = Number(rowsParam);
	return {
		cols: Number.isInteger(cols) && cols > 0 && cols <= 1000 ? cols : 80,
		rows: Number.isInteger(rows) && rows > 0 && rows <= 1000 ? rows : 24,
	};
};

/**
 * Terminal input and resize control messages share the same websocket
 * channel. Resize messages are JSON envelopes; regular keystrokes never
 * start with "{", so this distinguishes them without an extra channel.
 */
export const parseResizeMessage = (data: string) => {
	if (!data.startsWith("{")) return null;
	try {
		const parsed = JSON.parse(data);
		if (
			parsed?.type === "resize" &&
			Number.isInteger(parsed.cols) &&
			Number.isInteger(parsed.rows) &&
			parsed.cols > 0 &&
			parsed.cols <= 1000 &&
			parsed.rows > 0 &&
			parsed.rows <= 1000
		) {
			return { cols: parsed.cols, rows: parsed.rows };
		}
	} catch {
		return null;
	}
	return null;
};

export const getShell = () => {
	if (IS_CLOUD) {
		return "NO_AVAILABLE";
	}
	switch (os.platform()) {
		case "win32":
			return "powershell.exe";
		case "darwin":
			return "zsh";
		default:
			return "bash";
	}
};

/** Returns private SSH key for dokploy local server terminal. Uses already created SSH key or generates a new SSH key.
 */
export const setupLocalServerSSHKey = async () => {
	const { SSH_PATH } = paths(true);
	const sshKeyPath = path.join(SSH_PATH, "auto_generated-dokploy-local");

	if (!fs.existsSync(sshKeyPath)) {
		// Generate new SSH key if it hasn't been created yet
		await execAsync(
			`ssh-keygen -t rsa -b 4096 -f ${sshKeyPath} -N "" -C "dokploy-local-access"`,
		);
	}

	const privateKey = fs.readFileSync(sshKeyPath, "utf8");

	return privateKey;
};

/**
 * Installs Dokploy's generated local-terminal public key for a host user.
 *
 * Dokploy runs in a container, so it cannot normally write to the Docker
 * host's home directories. The local Docker socket is already required for
 * Dokploy operation; use it to run a short-lived copy of the current image
 * with the host filesystem mounted at /host. The fixed script resolves the
 * requested user through the host's passwd file and idempotently adds the key.
 */
export const authorizeLocalServerSSHKey = async (username: string) => {
	if (!isValidLocalServerUsername(username)) {
		throw new Error("Invalid local server username");
	}

	const currentContainerId = process.env.HOSTNAME?.trim() || os.hostname();
	const currentContainer = docker.getContainer(currentContainerId);
	const currentContainerInfo = await currentContainer.inspect();
	const helperContainer = await docker.createContainer({
		Image: currentContainerInfo.Image,
		Entrypoint: ["/bin/sh", "-c"],
		Cmd: [AUTHORIZE_LOCAL_SSH_KEY_SCRIPT],
		Env: [`TARGET_USER=${username}`],
		User: "0:0",
		Tty: true,
		NetworkDisabled: true,
		Labels: {
			"com.dokploy.temporary": "local-terminal-key-authorization",
		},
		HostConfig: {
			Binds: ["/:/host"],
			NetworkMode: "none",
			ReadonlyRootfs: true,
		},
	});

	try {
		await helperContainer.start();
		const result = await helperContainer.wait();
		if (result.StatusCode !== 0) {
			const output = await helperContainer.logs({
				stdout: true,
				stderr: true,
			});
			const detail = output.toString("utf8").trim();
			throw new Error(
				detail ||
					`Local SSH key authorization exited with code ${result.StatusCode}`,
			);
		}
	} finally {
		await helperContainer.remove({ force: true }).catch(() => undefined);
	}
};
