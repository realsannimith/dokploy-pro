package containers

import "testing"

func TestShouldMonitorContainerDefaultsToAllServices(t *testing.T) {
	monitorConfig = &MonitoringConfig{}

	if !ShouldMonitorContainer("workspace-workspacedb-uihovc.1.task") {
		t.Fatal("an empty include list should monitor all services")
	}
}

func TestShouldMonitorContainerSupportsWildcards(t *testing.T) {
	tests := []struct {
		name     string
		config   *MonitoringConfig
		expected bool
	}{
		{
			name: "star includes all services",
			config: &MonitoringConfig{
				IncludeServices: []string{"*"},
			},
			expected: true,
		},
		{
			name: "legacy empty sentinel includes all services",
			config: &MonitoringConfig{
				IncludeServices: []string{""},
			},
			expected: true,
		},
		{
			name: "star exclusion takes priority",
			config: &MonitoringConfig{
				IncludeServices: []string{"workspace-workspacedb-uihovc"},
				ExcludeServices: []string{"*"},
			},
			expected: false,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			monitorConfig = test.config
			actual := ShouldMonitorContainer("workspace-workspacedb-uihovc.1.task")
			if actual != test.expected {
				t.Fatalf("expected %v, got %v", test.expected, actual)
			}
		})
	}
}

func TestShouldMonitorContainerUsesConfiguredServiceNames(t *testing.T) {
	monitorConfig = &MonitoringConfig{
		IncludeServices: []string{"workspace-workspacedb-uihovc"},
	}

	if !ShouldMonitorContainer("workspace-workspacedb-uihovc.1.task") {
		t.Fatal("the selected Swarm service should be monitored")
	}

	if ShouldMonitorContainer("another-service.1.task") {
		t.Fatal("an unselected service should not be monitored")
	}
}
