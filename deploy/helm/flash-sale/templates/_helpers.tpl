{{/* Connection strings. The defaults point at the in-cluster services; config.* overrides them. */}}

{{- define "fs.redisUrl" -}}
{{- default "redis://redis:6379" .Values.config.redisUrl -}}
{{- end -}}

{{/* Empty string = real AWS SQS. Fall back to ElasticMQ only when it is enabled. */}}
{{- define "fs.sqsEndpoint" -}}
{{- if .Values.config.sqsEndpoint -}}
{{- .Values.config.sqsEndpoint -}}
{{- else if .Values.elasticmq.enabled -}}
http://elasticmq:9324
{{- end -}}
{{- end -}}

{{- define "fs.databaseUrl" -}}
{{- default (printf "postgres://%s:%s@postgres:5432/%s" .Values.postgres.user .Values.postgres.password .Values.postgres.database) .Values.config.databaseUrl -}}
{{- end -}}

{{- define "fs.labels" -}}
app.kubernetes.io/part-of: flash-sale
{{- end -}}
