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
    ('webhooks', 8087),
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
    only=['pnpm-workspace.yaml', 'package.json', 'pnpm-lock.yaml', 'tsconfig.base.json', 'packages', 'services/web', 'tools'],
)
k8s_yaml(helm('packages/helm-template', name='web', namespace='qaroom', values=['deploy/web/values.yaml']))

# moderator-agent (Milestone 9): the one Python service — uv + uvicorn, not tsx. Self-contained
# image (no pnpm workspace). live_update syncs src/rules and restarts the uvicorn process.
docker_build_with_restart(
    'qaroom/moderator-agent',
    '.',
    dockerfile='services/moderator-agent/Dockerfile',
    entrypoint=['uv', 'run', '--no-dev', 'python', '-m', 'moderator_agent.server'],
    live_update=[
        sync('services/moderator-agent/src', '/app/src'),
        sync('services/moderator-agent/rules', '/app/rules'),
    ],
    only=['services/moderator-agent'],
)
# The moderator needs an OpenAI key to classify (lazy — it boots without one, but every review
# fails until it is set). Read it from the shell env, falling back to services/moderator-agent/.env
# (gitignored), and inject it via Helm so `pnpm dev` wires it automatically — no `kubectl set env`
# to remember. Dev-only plaintext posture, like postgres.password (ADR-0009). With no key, /health,
# /ready and the NATS consumer still come up; only classification fails (a warning is printed).
def _moderator_openai_key():
    key = os.getenv('OPENAI_API_KEY', '')
    env_file = 'services/moderator-agent/.env'
    if not key and os.path.exists(env_file):
        for line in str(read_file(env_file)).splitlines():
            stripped = line.strip()
            if stripped.startswith('OPENAI_API_KEY=') and not stripped.startswith('#'):
                key = stripped.split('=', 1)[1].strip()
    return key

_moderator_key = _moderator_openai_key()
if not _moderator_key:
    warn('moderator-agent: no OPENAI_API_KEY in env or services/moderator-agent/.env — ' +
         '/health & the NATS consumer come up, but classification fails until a key is provided.')
k8s_yaml(helm(
    'packages/helm-template',
    name='moderator-agent',
    namespace='qaroom',
    values=['deploy/moderator-agent/values.yaml'],
    set=(['extraEnv.OPENAI_API_KEY=' + _moderator_key] if _moderator_key else []),
))

k8s_yaml([
    'deploy/observability/otel-collector.yaml',
    'deploy/observability/jaeger.yaml',
    'deploy/observability/prometheus.yaml',
    'deploy/observability/grafana.yaml',
    'deploy/observability/nats.yaml',
    'deploy/observability/tracetest.yaml',
    'deploy/observability/microcks.yaml',
    'deploy/observability/gc-dedup-cronjob.yaml',
    'deploy/observability/tracetest-import.yaml',
    'deploy/observability/webhook-receiver.yaml',
    'deploy/observability/langfuse.yaml',
])

# Traefik Ingress — the whole platform at http://*.localhost, no port-forward (the cluster must be
# created with Traefik + 80/443 mapped; see scripts/bootstrap-k3d.sh). The per-resource port_forwards
# below stay as a fallback for when Traefik/ingress is unavailable.
k8s_yaml('deploy/ingress.yaml')

# Services: Postgres first. flags/donations also wait on NATS; donations on Microcks (payment
# mock); the gateway is last (it proxies content/donations/flags, redeems WS tickets at
# identity, and reads NATS).
k8s_resource('content', resource_deps=['content-pg', 'qaroom-nats'], labels=['services'])
k8s_resource('identity', resource_deps=['identity-pg'], labels=['services'])
k8s_resource('flags', resource_deps=['flags-pg', 'qaroom-nats'], labels=['services'])
k8s_resource('donations', resource_deps=['donations-pg', 'qaroom-nats', 'qaroom-microcks'], labels=['services'])
# webhooks (Milestone 11): consumes all five event channels, delivers to external subscribers.
# Its delivery target in dev is the in-cluster echo receiver. port_forward 8087 (8085 is web).
k8s_resource('webhooks', port_forwards='8087:8087', resource_deps=['webhooks-pg', 'qaroom-nats'], labels=['services'])
k8s_resource('gateway', port_forwards='8080:8080', resource_deps=['content', 'identity', 'donations', 'flags', 'webhooks', 'qaroom-nats'], labels=['services'])
k8s_resource('web', port_forwards='8085:8085', resource_deps=['gateway'], labels=['services'])
# Python moderator: its own pgvector Postgres + NATS (it subscribes to post.created). Also waits on
# langfuse-web so the ON-BOOT Langfuse seed (prompt + golden dataset + annotation queue) runs after the
# API is up — it is one-shot, so a too-early boot would silently skip it. (Trace EXPORT stays
# best-effort regardless; this dep is only for the seed.)
k8s_resource('moderator-agent', port_forwards='8086:8086', resource_deps=['moderator-agent-pg', 'qaroom-nats', 'content', 'qaroom-langfuse-web'], labels=['services'])

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
# Auto-import the Tracetest definitions into the server so they show in the UI (no manual apply).
k8s_resource('qaroom-tracetest-import', resource_deps=['qaroom-tracetest'], labels=['observability'])

# Service virtualization for the payment provider (Milestone 5).
k8s_resource('qaroom-microcks', port_forwards='8888:8080', labels=['observability'])

# Dev webhook sink (Milestone 11): the echo endpoint webhooks-service delivers to.
k8s_resource('webhook-receiver', labels=['observability'])

# Langfuse v3 LLM-trace UI (spike). Backends first, then the bucket-init Job, then web + worker.
# web on :3001 (Grafana already holds :3001's neighbour :3000). UI at http://langfuse.localhost.
k8s_resource('qaroom-langfuse-postgres', labels=['langfuse'])
k8s_resource('qaroom-langfuse-clickhouse', labels=['langfuse'])
k8s_resource('qaroom-langfuse-redis', labels=['langfuse'])
k8s_resource('qaroom-langfuse-minio', labels=['langfuse'])
k8s_resource('qaroom-langfuse-minio-init', resource_deps=['qaroom-langfuse-minio'], labels=['langfuse'])
k8s_resource(
    'qaroom-langfuse-web',
    port_forwards='3001:3000',
    resource_deps=['qaroom-langfuse-postgres', 'qaroom-langfuse-clickhouse', 'qaroom-langfuse-redis', 'qaroom-langfuse-minio-init'],
    labels=['langfuse'],
)
k8s_resource(
    'qaroom-langfuse-worker',
    resource_deps=['qaroom-langfuse-postgres', 'qaroom-langfuse-clickhouse', 'qaroom-langfuse-redis', 'qaroom-langfuse-minio-init'],
    labels=['langfuse'],
)

print("QARoom on k3d — web :8085 · gateway :8080 · webhooks :8087 · moderator :8086 · Jaeger :16686 · Grafana :3000 · Prometheus :9090 · NATS :4222 · Tracetest :11633 · Microcks :8888 · Langfuse :3001 (langfuse.localhost)")
