{{- define "qaroom-service.name" -}}
{{- default .Release.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "qaroom-service.fullname" -}}
{{- default .Release.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "qaroom-service.pgFullname" -}}
{{- printf "%s-pg" (include "qaroom-service.fullname" .) -}}
{{- end -}}

{{- define "qaroom-service.labels" -}}
app.kubernetes.io/name: {{ include "qaroom-service.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
qaroom.io/service: {{ include "qaroom-service.name" . }}
{{- end -}}

{{- define "qaroom-service.selectorLabels" -}}
app.kubernetes.io/name: {{ include "qaroom-service.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "qaroom-service.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "qaroom-service.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{/* The DATABASE_URL: the in-cluster DSN when postgres is enabled, else the explicit value. */}}
{{- define "qaroom-service.databaseUrl" -}}
{{- if .Values.postgres.enabled -}}
postgres://{{ .Values.postgres.user }}:{{ .Values.postgres.password }}@{{ include "qaroom-service.pgFullname" . }}:5432/{{ .Values.postgres.database }}
{{- else -}}
{{- .Values.database.url -}}
{{- end -}}
{{- end -}}

{{/* Non-root, no-escalation, all-capabilities-dropped container securityContext (CKV_K8S_20/23/28/30/31/37/40).
     Applied to our own images (deployment.yaml, gc-cronjob.yaml) — not postgres, whose upstream image
     needs root at startup to gosu into its own postgres user (see postgres-statefulset.yaml's skip). */}}
{{- define "qaroom-service.containerSecurityContext" -}}
allowPrivilegeEscalation: false
readOnlyRootFilesystem: false
runAsNonRoot: true
runAsUser: {{ .Values.securityContext.runAsUser }}
runAsGroup: {{ .Values.securityContext.runAsUser }}
capabilities:
  drop: ["ALL"]
seccompProfile:
  type: RuntimeDefault
{{- end -}}

{{/* Pod-level counterpart (CKV_K8S_29): same UID/GID + fsGroup, seccomp restated per Checkov's
     pod-and-container expectation. */}}
{{- define "qaroom-service.podSecurityContext" -}}
runAsNonRoot: true
runAsUser: {{ .Values.securityContext.runAsUser }}
runAsGroup: {{ .Values.securityContext.runAsUser }}
fsGroup: {{ .Values.securityContext.runAsUser }}
seccompProfile:
  type: RuntimeDefault
{{- end -}}

{{/* Capabilities-only securityContext for the postgres container (CKV_K8S_28/31/37): the upstream
     image's entrypoint runs as root then gosu's to its own `postgres` user, so runAsNonRoot/a fixed
     UID is left alone (#checkov:skip on the StatefulSet covers CKV_K8S_23/40). */}}
{{- define "qaroom-service.postgresSecurityContext" -}}
allowPrivilegeEscalation: false
capabilities:
  drop: ["ALL"]
seccompProfile:
  type: RuntimeDefault
{{- end -}}
