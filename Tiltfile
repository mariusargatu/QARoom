# QARoom local dev (Milestone 3): build each service image, deploy via the shared Helm
# chart + per-service Postgres, and bring up the observability stack — all on k3d.
#
# Inner loop: `live_update` syncs src/ into the running container and `restart_process`
# re-runs `tsx` (no image rebuild) → ~1s warm reload. Cold first build installs deps
# (layer-cached afterwards). Interpret the <2min exit criterion as the warm path.

load('ext://restart_process', 'docker_build_with_restart')

allow_k8s_contexts('k3d-qaroom')
default_registry('k3d-qaroom-registry.localhost:5111')

# Node backend services share the tsx-telemetry entrypoint + live_update reload.
services = [
    ('content', 8081),
    ('identity', 8082),
    ('gateway', 8080),
    ('flags', 8083),
    ('donations', 8084),
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

# Web frontend: a Vite build served by `vite preview` (static SPA), no tsx entrypoint.
docker_build(
    'qaroom/web',
    '.',
    dockerfile='services/web/Dockerfile',
    only=['pnpm-workspace.yaml', 'package.json', 'pnpm-lock.yaml', 'packages', 'services/web', 'tools'],
)
k8s_yaml(helm('packages/helm-template', name='web', namespace='qaroom', values=['deploy/web/values.yaml']))

k8s_yaml([
    'deploy/observability/otel-collector.yaml',
    'deploy/observability/jaeger.yaml',
    'deploy/observability/prometheus.yaml',
    'deploy/observability/grafana.yaml',
    'deploy/observability/nats.yaml',
    'deploy/observability/tracetest.yaml',
    'deploy/observability/microcks.yaml',
    'deploy/observability/gc-dedup-cronjob.yaml',
])

# Services: Postgres first. flags/donations also wait on NATS; donations on Microcks (payment
# mock); the gateway is last (it proxies content + redeems WS tickets at identity + reads NATS).
k8s_resource('content', resource_deps=['content-pg', 'qaroom-nats'], labels=['services'])
k8s_resource('identity', resource_deps=['identity-pg'], labels=['services'])
k8s_resource('flags', resource_deps=['flags-pg', 'qaroom-nats'], labels=['services'])
k8s_resource('donations', resource_deps=['donations-pg', 'qaroom-nats', 'qaroom-microcks'], labels=['services'])
k8s_resource('gateway', port_forwards='8080:8080', resource_deps=['content', 'identity', 'qaroom-nats'], labels=['services'])
k8s_resource('web', port_forwards='8085:8085', resource_deps=['gateway'], labels=['services'])

# Observability UIs. The collector exports traces to BOTH Jaeger and Tracetest, so it must
# start AFTER both — otherwise its gRPC client to Tracetest resolves no endpoint ("no
# children to pick from") and drops spans until it re-resolves. Tracetest is the receiver
# (its own OTLP server + Postgres), so it does NOT depend on the collector — that back-edge
# would be a cycle. This ordering makes a clean `pnpm dev` wire up trace ingestion with no
# manual collector restart.
k8s_resource('qaroom-otel-collector', resource_deps=['qaroom-jaeger', 'qaroom-tracetest'], labels=['observability'])
k8s_resource('qaroom-jaeger', port_forwards='16686:16686', labels=['observability'])
k8s_resource('qaroom-grafana', port_forwards='3000:3000', labels=['observability'])
k8s_resource('qaroom-prometheus', port_forwards='9090:9090', labels=['observability'])

# Async messaging + trace-based testing (Milestone 4).
k8s_resource('qaroom-nats', port_forwards='4222:4222', labels=['observability'])
k8s_resource('qaroom-tracetest', port_forwards='11633:11633', resource_deps=['qaroom-tracetest-postgres'], labels=['observability'])

# Service virtualization for the payment provider (Milestone 5).
k8s_resource('qaroom-microcks', port_forwards='8888:8080', labels=['observability'])

print("QARoom on k3d — web :8085 · gateway :8080 · Jaeger :16686 · Grafana :3000 · Prometheus :9090 · NATS :4222 · Tracetest :11633 · Microcks :8888")
