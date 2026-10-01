CREATE INDEX environments_physical_pod_lookup ON task_runtime.environments (namespace, pod_name);
