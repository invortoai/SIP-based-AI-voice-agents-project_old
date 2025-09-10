variable "cluster_name" {
  description = "EKS cluster name"
  type        = string
}

variable "enable_istio" {
  description = "Enable Istio service mesh"
  type        = bool
  default     = true
}

variable "istio_version" {
  description = "Istio version to install"
  type        = string
  default     = "1.18.0"
}

variable "enable_kiali" {
  description = "Enable Kiali for service mesh observability"
  type        = bool
  default     = true
}

variable "enable_jaeger" {
  description = "Enable Jaeger for distributed tracing"
  type        = bool
  default     = true
}

variable "enable_prometheus" {
  description = "Enable Prometheus for metrics collection"
  type        = bool
  default     = true
}

variable "ssl_certificate_arn" {
  description = "ARN of SSL certificate for ingress gateway"
  type        = string
  default     = ""
}

variable "jwt_issuer" {
  description = "JWT issuer for request authentication"
  type        = string
  default     = ""
}

variable "jwks_uri" {
  description = "JWKS URI for JWT validation"
  type        = string
  default     = ""
}

variable "jwt_audience" {
  description = "JWT audience for request authentication"
  type        = string
  default     = ""
}

variable "tags" {
  description = "Additional tags for resources"
  type        = map(string)
  default     = {}
}