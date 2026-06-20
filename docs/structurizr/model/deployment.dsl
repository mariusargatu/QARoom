# Deployment topology: the local k3d cluster brought up by `pnpm dev` (Tilt against k3d).
# Source: scripts/bootstrap-k3d.sh, Tiltfile, deploy/ingress.yaml, deploy/<svc>/values.yaml,
# deploy/observability/*.yaml, packages/helm-template/ (the shared qaroom-service chart).
# NOTE: qaroom-mcp is NOT cluster-deployed (no Dockerfile/chart, ADR-0006) so it has no instance here.
# service<->db, service<->nats edges are auto-derived from the model; the ingress + observability
# edges are declared explicitly below (full hierarchical paths, required in identifiers=hierarchical).

deploymentEnvironment "k3d (local)" {

    ws = deploymentNode "Developer workstation" "macOS; *.localhost resolves to 127.0.0.1" "Docker Desktop" {
        browser = infrastructureNode "Browser" "qaroom.localhost; observability UIs" "" "Infra"

        cluster = deploymentNode "k3d: qaroom cluster" "Single k3s node; 80/443 mapped to the loadbalancer" "k3s / k3d" {
            traefik = infrastructureNode "Traefik Ingress" "*.localhost host routing (qaroom / moderator / grafana / jaeger / prometheus / tracetest / microcks / langfuse)" "Traefik" "Infra"

            appNs = deploymentNode "namespace: qaroom" "App services, one shared Helm chart per release" "Kubernetes namespace" {

                gwNode = deploymentNode "gateway (Deployment x1)" {
                    gwI = containerInstance qaroom.gateway
                }
                webNode = deploymentNode "web (Deployment x1)" "Vite preview, static SPA" {
                    webI = containerInstance qaroom.web
                }
                ctNode = deploymentNode "content (Deployment x1)" {
                    ctI = containerInstance qaroom.content
                    deploymentNode "content-pg (StatefulSet)" "emptyDir; dev creds" "Postgres 18" {
                        containerInstance qaroom.contentDb
                    }
                }
                idNode = deploymentNode "identity (Deployment x1)" {
                    idI = containerInstance qaroom.identity
                    deploymentNode "identity-pg (StatefulSet)" "" "Postgres 18" {
                        containerInstance qaroom.identityDb
                    }
                }
                flNode = deploymentNode "flags (Deployment x1)" {
                    flI = containerInstance qaroom.flags
                    deploymentNode "flags-pg (StatefulSet)" "" "Postgres 18" {
                        containerInstance qaroom.flagsDb
                    }
                }
                donNode = deploymentNode "donations (Deployment x1)" {
                    donI = containerInstance qaroom.donations
                    deploymentNode "donations-pg (StatefulSet)" "" "Postgres 18" {
                        containerInstance qaroom.donationsDb
                    }
                }
                whNode = deploymentNode "webhooks (Deployment x1)" {
                    whI = containerInstance qaroom.webhooks
                    deploymentNode "webhooks-pg (StatefulSet)" "" "Postgres 18" {
                        containerInstance qaroom.webhooksDb
                    }
                }
                modNode = deploymentNode "moderator-agent (Deployment x1)" "Python uvicorn" {
                    modI = containerInstance qaroom.moderator
                    deploymentNode "moderator-pg (StatefulSet)" "" "Postgres 18 + pgvector" {
                        containerInstance qaroom.moderatorDb
                    }
                }

                gcJobs = infrastructureNode "gc-dedup CronJobs" "Hourly TTL GC per service (outbox / processed_events / idempotency_responses); webhooks ledger retained" "Kubernetes CronJob" "Infra"
                whSink = infrastructureNode "webhook-receiver" "Dev echo sink for outbound deliveries" "mendhak/http-https-echo" "Infra"
            }

            obsNs = deploymentNode "namespace: observability" "Shared backplane (read-only to app namespaces)" "Kubernetes namespace" {
                deploymentNode "NATS JetStream (Deployment x1)" "File store, max 1GB; duplicate_window 5m" "NATS" {
                    containerInstance qaroom.nats
                }
                collector = infrastructureNode "OTel Collector" "OTLP 4317/4318; dual-export Jaeger + Tracetest; Prometheus exporter :8889" "OpenTelemetry Collector" "Infra"
                jaeger    = infrastructureNode "Jaeger" "Trace store + UI :16686 (in-memory)" "Jaeger" "Infra"
                prom      = infrastructureNode "Prometheus" "Scrapes the collector + pod annotations :9090" "Prometheus" "Infra"
                grafana   = infrastructureNode "Grafana" "Dashboards :3000 (anonymous admin, dev)" "Grafana" "Infra"
                tracetest = infrastructureNode "Tracetest" "Trace-as-assertion :11633 (own Postgres)" "Tracetest" "Infra"
                microcks  = infrastructureNode "Microcks" "Payment-provider mock :8080 (OpenAPI-driven)" "Microcks" "Infra"
                langfuse  = infrastructureNode "Langfuse v3" "LLM-trace UI (Postgres + ClickHouse + Redis + MinIO)" "Langfuse" "Infra"
            }
        }
    }

    # ---- ingress + observability wiring (full hierarchical paths) ----
    ws.browser -> ws.cluster.traefik "HTTPS" "HTTP"
    ws.cluster.traefik -> ws.cluster.appNs.gwNode.gwI   "qaroom.localhost /api + /ws" "HTTP"
    ws.cluster.traefik -> ws.cluster.appNs.webNode.webI "qaroom.localhost /" "HTTP"
    ws.cluster.traefik -> ws.cluster.appNs.modNode.modI "moderator.localhost" "HTTP"
    # every app service except web (OTel disabled there) exports OTLP to the one collector
    ws.cluster.appNs.gwNode.gwI   -> ws.cluster.obsNs.collector "OTLP spans" "OTLP"
    ws.cluster.appNs.ctNode.ctI   -> ws.cluster.obsNs.collector "OTLP spans" "OTLP"
    ws.cluster.appNs.idNode.idI   -> ws.cluster.obsNs.collector "OTLP spans" "OTLP"
    ws.cluster.appNs.flNode.flI   -> ws.cluster.obsNs.collector "OTLP spans" "OTLP"
    ws.cluster.appNs.donNode.donI -> ws.cluster.obsNs.collector "OTLP spans" "OTLP"
    ws.cluster.appNs.whNode.whI   -> ws.cluster.obsNs.collector "OTLP spans" "OTLP"
    ws.cluster.appNs.modNode.modI -> ws.cluster.obsNs.collector "OTLP spans + GenAI traces" "OTLP"
    ws.cluster.obsNs.collector -> ws.cluster.obsNs.jaeger    "Exports traces" "OTLP"
    ws.cluster.obsNs.collector -> ws.cluster.obsNs.tracetest "Exports traces" "OTLP"
    ws.cluster.obsNs.collector -> ws.cluster.obsNs.prom      "Exposes metrics" "Prometheus"
    ws.cluster.obsNs.grafana -> ws.cluster.obsNs.prom   "Queries" "PromQL"
    ws.cluster.obsNs.grafana -> ws.cluster.obsNs.jaeger "Queries" "Jaeger API"
    ws.cluster.appNs.donNode.donI -> ws.cluster.obsNs.microcks "Charges (payment mock)" "HTTP/JSON"
    ws.cluster.appNs.modNode.modI -> ws.cluster.obsNs.langfuse "LLM traces" "HTTP"
}
