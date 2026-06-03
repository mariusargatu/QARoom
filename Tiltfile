# QARoom local dev (Milestone 3): build each service image, deploy via the shared Helm
# chart + per-service Postgres, and bring up the observability stack — all on k3d.
#
# Inner loop: `live_update` syncs src/ into the running container and `restart_process`
# re-runs `tsx` (no image rebuild) → ~1s warm reload. Cold first build installs deps
# (layer-cached afterwards). Interpret the <2min exit criterion as the warm path.

load('ext://restart_process', 'docker_build_with_restart')

allow_k8s_contexts('k3d-qaroom')
default_registry('k3d-qaroom-registry.localhost:5111')

services = [
    ('content', 8081),
    ('identity', 8082),
    ('gateway', 8080),
]

for name, port in services:
    docker_build_with_restart(
        'qaroom/%s' % name,
        '.',
        dockerfile='services/%s/Dockerfile' % name,
        entrypoint=['pnpm', '--filter', '@qaroom/%s' % name, 'exec', 'tsx', '--import', './src/telemetry.ts', 'src/server.ts'],
        live_update=[
            sync('services/%s/src' % name, '/repo/services/%s/src' % name),
            sync('packages', '/repo/packages'),
        ],
        only=['pnpm-workspace.yaml', 'package.json', 'pnpm-lock.yaml', 'packages', 'services/%s' % name, 'tools'],
    )
    k8s_yaml(helm('packages/helm-template', name=name, namespace='qaroom', values=['deploy/%s/values.yaml' % name]))

k8s_yaml([
    'deploy/observability/otel-collector.yaml',
    'deploy/observability/jaeger.yaml',
    'deploy/observability/prometheus.yaml',
    'deploy/observability/grafana.yaml',
])

# Services: Postgres first, gateway last.
k8s_resource('content', resource_deps=['content-pg'], labels=['services'])
k8s_resource('identity', resource_deps=['identity-pg'], labels=['services'])
k8s_resource('gateway', port_forwards='8080:8080', resource_deps=['content', 'identity'], labels=['services'])

# Observability UIs.
k8s_resource('qaroom-otel-collector', resource_deps=['qaroom-jaeger'], labels=['observability'])
k8s_resource('qaroom-jaeger', port_forwards='16686:16686', labels=['observability'])
k8s_resource('qaroom-grafana', port_forwards='3000:3000', labels=['observability'])
k8s_resource('qaroom-prometheus', port_forwards='9090:9090', labels=['observability'])

print("QARoom on k3d — gateway :8080 · Jaeger :16686 · Grafana :3000 · Prometheus :9090")
