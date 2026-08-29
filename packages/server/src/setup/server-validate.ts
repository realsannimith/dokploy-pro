import { Client } from "ssh2";
import { findServerById } from "../services/server";

export const validateDocker = () => `
  if command_exists docker; then
     echo "$(docker --version | awk '{print $3}' | sed 's/,//') true"
  else
    echo "0.0.0 false"
  fi
`;

export const validateDockerDaemon = () => `
  if docker info >/dev/null 2>&1; then
    echo true
  else
    echo false
  fi
`;

export const validateDockerCompose = () => `
  if docker compose version >/dev/null 2>&1; then
    version=$(docker compose version --short 2>/dev/null | sed 's/^v//')
    [ -z "$version" ] && version="installed"
    echo "$version true"
  else
    echo "0.0.0 false"
  fi
`;

export const validateRClone = () => `
  if command_exists rclone; then
    echo "$(rclone --version | head -n 1 | awk '{print $2}' | sed 's/^v//') true"
  else
    echo "0.0.0 false"
  fi
`;

export const validateSwarm = () => `
  if docker info --format '{{.Swarm.LocalNodeState}}' | grep -q 'active'; then
    echo true
  else
    echo false
  fi
`;

export const validateNixpacks = () => `
  if command_exists nixpacks; then
	version=$(nixpacks --version | awk '{print $2}')
    if [ -n "$version" ]; then
      echo "$version true"
    else
      echo "0.0.0 false"
    fi
  else
    echo "0.0.0 false"
  fi
`;

export const validateRailpack = () => `
  if command_exists railpack; then
    version=$(railpack --version | awk '{print $3}')
    if [ -n "$version" ]; then
      echo "$version true"
    else
      echo "0.0.0 false"
    fi
  else
    echo "0.0.0 false"
  fi
`;
export const validateBuildpacks = () => `
  if command_exists pack; then
    version=$(pack --version | awk '{print $1}')
    if [ -n "$version" ]; then
      echo "$version true"
    else
      echo "0.0.0 false"
    fi
  else
    echo "0.0.0 false"
  fi
`;

export const validateMainDirectory = () => `
  if [ -d "/etc/dokploy" ]; then
	echo true
  else
	echo false
  fi
`;

export const validateDokployNetwork = () => `
  if docker network ls | grep -q 'dokploy-network'; then
	echo true
  else
	echo false
  fi
`;

export const validateSudoAccess = () => `
  if [ "$(id -u)" -eq 0 ]; then
    echo "root true"
  elif sudo -n true 2>/dev/null; then
    echo "sudo true"
  else
    echo "none false"
  fi
`;

export const validateDockerGroup = () => `
  if [ "$(id -u)" -eq 0 ] || groups | grep -qw docker; then
    echo true
  else
    echo false
  fi
`;

export const validateDirectoryWritable = () => `
  if [ -d "/etc/dokploy" ] && [ -w "/etc/dokploy" ]; then
    echo true
  else
    echo false
  fi
`;

export const validateTraefik = () => `
  if docker inspect dokploy-traefik >/dev/null 2>&1; then
    running=$(docker inspect --format '{{.State.Running}}' dokploy-traefik 2>/dev/null)
    echo "true $running"
  else
    echo "false false"
  fi
`;

export const validateMonitoring = (port: number) => `
  if docker service inspect dokploy-monitoring >/dev/null 2>&1; then
    monitoringInstalled=true
  else
    monitoringInstalled=false
  fi

  if docker service ps dokploy-monitoring --filter desired-state=running --format '{{.CurrentState}}' 2>/dev/null | grep -q '^Running'; then
    monitoringRunning=true
  else
    monitoringRunning=false
  fi

  if curl -fsS --max-time 3 http://127.0.0.1:${port}/health >/dev/null 2>&1; then
    monitoringReachable=true
  else
    monitoringReachable=false
  fi

  echo "$monitoringInstalled $monitoringRunning $monitoringReachable"
`;

export interface ServerValidationResult {
	sshConnected: boolean;
	allFeaturesReady: boolean;
	docker: { enabled: boolean; version: string; daemonAccessible: boolean };
	dockerCompose: { enabled: boolean; version: string };
	rclone: { enabled: boolean; version: string };
	nixpacks: { enabled: boolean; version: string };
	buildpacks: { enabled: boolean; version: string };
	railpack: { enabled: boolean; version: string };
	isDokployNetworkInstalled: boolean;
	isSwarmInstalled: boolean;
	isMainDirectoryInstalled: boolean;
	dokployDirectoryWritable: boolean;
	privilegeMode: string;
	dockerGroupMember: boolean;
	traefik: { installed: boolean; running: boolean };
	monitoring: {
		configured: boolean;
		serviceInstalled: boolean;
		running: boolean;
		localReachable: boolean;
	};
}

type RawServerValidationResult = Omit<
	ServerValidationResult,
	"sshConnected" | "allFeaturesReady" | "monitoring"
> & {
	monitoring: Omit<ServerValidationResult["monitoring"], "configured">;
};

export const serverValidate = async (
	serverId: string,
): Promise<ServerValidationResult> => {
	const client = new Client();
	const server = await findServerById(serverId);
	if (!server.sshKeyId) {
		throw new Error("No SSH Key found");
	}

	return new Promise<ServerValidationResult>((resolve, reject) => {
		client
			.once("ready", () => {
				const bashCommand = `
          command_exists() {
            command -v "$@" > /dev/null 2>&1
          }

	          dockerVersionEnabled=$(${validateDocker()})
	          dockerDaemonAccessible=$(${validateDockerDaemon()})
	          dockerComposeVersionEnabled=$(${validateDockerCompose()})
	          rcloneVersionEnabled=$(${validateRClone()})
          nixpacksVersionEnabled=$(${validateNixpacks()})
          buildpacksVersionEnabled=$(${validateBuildpacks()})
          railpackVersionEnabled=$(${validateRailpack()})
	          dockerVersion=$(echo $dockerVersionEnabled | awk '{print $1}')
	          dockerEnabled=$(echo $dockerVersionEnabled | awk '{print $2}')
	          dockerComposeVersion=$(echo $dockerComposeVersionEnabled | awk '{print $1}')
	          dockerComposeEnabled=$(echo $dockerComposeVersionEnabled | awk '{print $2}')

          rcloneVersion=$(echo $rcloneVersionEnabled | awk '{print $1}')
          rcloneEnabled=$(echo $rcloneVersionEnabled | awk '{print $2}')

          nixpacksVersion=$(echo $nixpacksVersionEnabled | awk '{print $1}')
          nixpacksEnabled=$(echo $nixpacksVersionEnabled | awk '{print $2}')

          railpackVersion=$(echo $railpackVersionEnabled | awk '{print $1}')
          railpackEnabled=$(echo $railpackVersionEnabled | awk '{print $2}')

          buildpacksVersion=$(echo $buildpacksVersionEnabled | awk '{print $1}')
          buildpacksEnabled=$(echo $buildpacksVersionEnabled | awk '{print $2}')

	          isDokployNetworkInstalled=$(${validateDokployNetwork()})
	          isSwarmInstalled=$(${validateSwarm()})
	          isMainDirectoryInstalled=$(${validateMainDirectory()})
	          isDokployDirectoryWritable=$(${validateDirectoryWritable()})
	          traefikStatus=$(${validateTraefik()})
	          traefikInstalled=$(echo $traefikStatus | awk '{print $1}')
	          traefikRunning=$(echo $traefikStatus | awk '{print $2}')
	          monitoringStatus=$(${validateMonitoring(server.metricsConfig.server.port)})
	          monitoringServiceInstalled=$(echo $monitoringStatus | awk '{print $1}')
	          monitoringRunning=$(echo $monitoringStatus | awk '{print $2}')
	          monitoringLocalReachable=$(echo $monitoringStatus | awk '{print $3}')

          sudoAccessResult=$(${validateSudoAccess()})
          privilegeMode=$(echo $sudoAccessResult | awk '{print $1}')
          isDockerGroupMember=$(${validateDockerGroup()})

  echo "{\\"docker\\": {\\"version\\": \\"$dockerVersion\\", \\"enabled\\": $dockerEnabled, \\"daemonAccessible\\": $dockerDaemonAccessible}, \\"dockerCompose\\": {\\"version\\": \\"$dockerComposeVersion\\", \\"enabled\\": $dockerComposeEnabled}, \\"rclone\\": {\\"version\\": \\"$rcloneVersion\\", \\"enabled\\": $rcloneEnabled}, \\"nixpacks\\": {\\"version\\": \\"$nixpacksVersion\\", \\"enabled\\": $nixpacksEnabled}, \\"buildpacks\\": {\\"version\\": \\"$buildpacksVersion\\", \\"enabled\\": $buildpacksEnabled}, \\"railpack\\": {\\"version\\": \\"$railpackVersion\\", \\"enabled\\": $railpackEnabled}, \\"isDokployNetworkInstalled\\": $isDokployNetworkInstalled, \\"isSwarmInstalled\\": $isSwarmInstalled, \\"isMainDirectoryInstalled\\": $isMainDirectoryInstalled, \\"dokployDirectoryWritable\\": $isDokployDirectoryWritable, \\"privilegeMode\\": \\"$privilegeMode\\", \\"dockerGroupMember\\": $isDockerGroupMember, \\"traefik\\": {\\"installed\\": $traefikInstalled, \\"running\\": $traefikRunning}, \\"monitoring\\": {\\"serviceInstalled\\": $monitoringServiceInstalled, \\"running\\": $monitoringRunning, \\"localReachable\\": $monitoringLocalReachable}}"
        `;
				client.exec(bashCommand, (err, stream) => {
					if (err) {
						reject(err);
						return;
					}
					let output = "";
					stream
						.on("close", () => {
							client.end();
							try {
								const result = JSON.parse(
									output.trim(),
								) as RawServerValidationResult;
								const monitoringConfigured = Boolean(
									server.metricsConfig.server.token,
								);
								const baseReady =
									result.docker.enabled &&
									result.docker.daemonAccessible &&
									result.dockerCompose.enabled &&
									result.isMainDirectoryInstalled &&
									result.dokployDirectoryWritable &&
									(result.privilegeMode === "root" ||
										result.privilegeMode === "sudo") &&
									result.dockerGroupMember &&
									result.nixpacks.enabled &&
									result.buildpacks.enabled &&
									result.railpack.enabled;
								const deployReady =
									result.rclone.enabled &&
									result.isSwarmInstalled &&
									result.isDokployNetworkInstalled &&
									result.traefik.installed &&
									result.traefik.running &&
									monitoringConfigured &&
									result.monitoring.serviceInstalled &&
									result.monitoring.running &&
									result.monitoring.localReachable;

								resolve({
									...result,
									sshConnected: true,
									allFeaturesReady:
										baseReady && (server.serverType === "build" || deployReady),
									monitoring: {
										...result.monitoring,
										configured: monitoringConfigured,
									},
								});
							} catch (parseError) {
								reject(
									new Error(
										`Failed to parse output: ${parseError instanceof Error ? parseError.message : parseError}`,
									),
								);
							}
						})
						.on("data", (data: string) => {
							output += data;
						})
						.stderr.on("data", (_data) => {});
				});
			})
			.on("error", (err) => {
				client.end();
				if (err.level === "client-authentication") {
					reject(
						new Error(
							`Authentication failed: Invalid SSH private key. ❌ Error: ${err.message} ${err.level}`,
						),
					);
				} else {
					reject(new Error(`SSH connection error: ${err.message}`));
				}
			})
			.connect({
				host: server.ipAddress,
				port: server.port,
				username: server.username,
				privateKey: server.sshKey?.privateKey,
			});
	});
};
