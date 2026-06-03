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
