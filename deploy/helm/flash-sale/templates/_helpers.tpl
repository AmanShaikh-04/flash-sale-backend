{{/* Connection strings. The defaults point at the in-cluster services; config.* overrides them. */}}

{{- define "fs.redisUrl" -}}
{{- default "redis://redis:6379" .Values.config.redisUrl -}}
{{- end -}}

{{- define "fs.sqsEndpoint" -}}
{{- default "http://elasticmq:9324" .Values.config.sqsEndpoint -}}
{{- end -}}

{{- define "fs.databaseUrl" -}}
{{- default (printf "postgres://%s:%s@postgres:5432/%s" .Values.postgres.user .Values.postgres.password .Values.postgres.database) .Values.config.databaseUrl -}}
{{- end -}}

{{- define "fs.labels" -}}
app.kubernetes.io/part-of: flash-sale
{{- end -}}
