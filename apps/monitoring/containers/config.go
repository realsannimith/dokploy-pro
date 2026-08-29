package containers

import (
	"strconv"
	"strings"

	"github.com/mauriciogm/dokploy/apps/monitoring/config"
)

var monitorConfig *MonitoringConfig

func LoadConfig() error {
	cfg := config.GetMetricsConfig()
	monitorConfig = &MonitoringConfig{
		IncludeServices: make([]string, len(cfg.Containers.Services.Include)),
		ExcludeServices: make([]string, len(cfg.Containers.Services.Exclude)),
	}

	// Convert Include services
	for i, svc := range cfg.Containers.Services.Include {
		monitorConfig.IncludeServices[i] = svc
	}

	// Convert Exclude services
	for i, appName := range cfg.Containers.Services.Exclude {
		monitorConfig.ExcludeServices[i] = appName
	}

	return nil
}

func ShouldMonitorContainer(containerName string) bool {
	if monitorConfig == nil {
		return false
	}

	for _, excluded := range monitorConfig.ExcludeServices {
		if matchesService(containerName, excluded) {
			return false
		}
	}

	if len(monitorConfig.IncludeServices) > 0 {
		for _, included := range monitorConfig.IncludeServices {
			if matchesService(containerName, included) {
				return true
			}
		}
		return false
	}

	return true
}

// Empty include lists have always represented "all services" in
// ShouldMonitorContainer. Treat both "*" and the legacy empty-string sentinel
// the same way so existing monitoring services can use that behavior too.
func matchesService(containerName string, service string) bool {
	return service == "" || service == "*" || strings.Contains(containerName, service)
}

func GetServiceName(containerName string) string {
	name := NormalizeContainerName(containerName)
	if name != strings.TrimPrefix(containerName, "/") {
		return name
	}

	parts := strings.Split(name, "-")
	if len(parts) > 1 {
		return strings.Join(parts[:len(parts)-1], "-")
	}
	return name
}

// NormalizeContainerName converts a Docker Swarm task name such as
// service-name.1.task-id back to the stable service name. Standalone and
// Docker Compose names are preserved because the dashboard addresses those
// containers by their complete Docker name.
func NormalizeContainerName(containerName string) string {
	name := strings.TrimPrefix(containerName, "/")
	parts := strings.Split(name, ".")
	if len(parts) < 3 {
		return name
	}

	slot := parts[len(parts)-2]
	if _, err := strconv.Atoi(slot); err != nil {
		return name
	}

	return strings.Join(parts[:len(parts)-2], ".")
}
