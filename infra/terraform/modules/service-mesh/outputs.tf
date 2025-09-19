output "istio_ingress_ip" {
  description = "Load balancer IP for Istio ingress gateway"
  value = var.enable_istio ? try(
    helm_release.istio_ingress[0].status[0].load_balancer[0].ingress[0].hostname,
    null
  ) : null
}

output "kiali_url" {
  description = "Kiali dashboard URL"
  value       = var.enable_kiali ? "http://kiali.istio-system.svc.cluster.local:20001" : null
}

output "jaeger_url" {
  description = "Jaeger UI URL"
  value       = var.enable_jaeger ? "http://jaeger.istio-system.svc.cluster.local:16686" : null
}

output "prometheus_url" {
  description = "Prometheus URL"
  value       = var.enable_prometheus ? "http://prometheus-server.istio-system.svc.cluster.local" : null
}

output "istio_namespaces" {
  description = "List of namespaces with Istio injection enabled"
  value = var.enable_istio ? try([
    for ns in kubernetes_namespace.invorto_services : ns.metadata[0].name
  ], []) : []
}

output "service_mesh_endpoints" {
  description = "Service mesh endpoint information"
  value = {
    graphql_endpoint   = var.enable_istio ? "https://api.invorto.ai/graphql" : null
    websocket_endpoint = var.enable_istio ? "wss://api.invorto.ai/graphql" : null
    health_endpoint    = var.enable_istio ? "https://api.invorto.ai/health" : null
    metrics_endpoint   = var.enable_istio ? "https://api.invorto.ai/metrics" : null
  }
}

output "istio_gateway_name" {
  description = "Istio ingress gateway name"
  value = var.enable_istio ? try(
    kubernetes_manifest.api_gateway[0].manifest.metadata.name,
    null
  ) : null
}

output "istio_virtual_service_name" {
  description = "API virtual service name"
  value = var.enable_istio ? try(
    kubernetes_manifest.api_virtual_service[0].manifest.metadata.name,
    null
  ) : null
}

output "istio_destination_rule_name" {
  description = "API destination rule name"
  value = var.enable_istio ? try(
    kubernetes_manifest.api_destination_rule[0].manifest.metadata.name,
    null
  ) : null
}