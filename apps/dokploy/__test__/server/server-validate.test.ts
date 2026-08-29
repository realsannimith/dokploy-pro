import {
	validateDirectoryWritable,
	validateDockerCompose,
	validateDockerDaemon,
	validateDockerGroup,
	validateMonitoring,
	validateTraefik,
} from "@dokploy/server";
import { describe, expect, it } from "vitest";

describe("remote server full-feature validation", () => {
	it("checks Docker daemon and Compose access", () => {
		expect(validateDockerDaemon()).toContain("docker info");
		expect(validateDockerCompose()).toContain("docker compose version");
	});

	it("treats root as having Docker access and checks Dokploy write access", () => {
		expect(validateDockerGroup()).toContain('"$(id -u)" -eq 0');
		expect(validateDirectoryWritable()).toContain('[ -w "/etc/dokploy" ]');
	});

	it("checks Traefik and the monitoring agent on the configured port", () => {
		expect(validateTraefik()).toContain("docker inspect dokploy-traefik");
		const monitoring = validateMonitoring(4655);
		expect(monitoring).toContain("docker service inspect dokploy-monitoring");
		expect(monitoring).toContain("http://127.0.0.1:4655/health");
	});
});
