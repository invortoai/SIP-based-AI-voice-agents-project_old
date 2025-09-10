# Service Mesh Infrastructure Module
# Provides Istio service mesh configuration for microservices communication

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.0"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.0"
    }
  }
}

locals {
  name_prefix = "invorto-istio"
  tags = merge(var.tags, {
    Service = "service-mesh"
    Component = "istio"
  })
}

# EKS Cluster (assumed to exist)
data "aws_eks_cluster" "main" {
  name = var.cluster_name
}

data "aws_eks_cluster_auth" "main" {
  name = var.cluster_name
}

# Kubernetes provider configuration
provider "kubernetes" {
  host                   = data.aws_eks_cluster.main.endpoint
  cluster_ca_certificate = base64decode(data.aws_eks_cluster.main.certificate_authority[0].data)
  token                  = data.aws_eks_cluster_auth.main.token
}

provider "helm" {
  kubernetes {
    host                   = data.aws_eks_cluster.main.endpoint
    cluster_ca_certificate = base64decode(data.aws_eks_cluster.main.certificate_authority[0].data)
    token                  = data.aws_eks_cluster_auth.main.token
  }
}

# Istio namespace
resource "kubernetes_namespace" "istio_system" {
  count = var.enable_istio ? 1 : 0

  metadata {
    name = "istio-system"
    labels = {
      istio-injection = "disabled"
    }
  }
}

# Istio base installation
resource "helm_release" "istio_base" {
  count = var.enable_istio ? 1 : 0

  name       = "istio-base"
  repository = "https://istio-release.storage.googleapis.com/charts"
  chart      = "istio/base"
  version    = var.istio_version
  namespace  = kubernetes_namespace.istio_system[0].metadata[0].name

  set {
    name  = "global.istioNamespace"
    value = kubernetes_namespace.istio_system[0].metadata[0].name
  }
}

# Istiod control plane
resource "helm_release" "istiod" {
  count = var.enable_istio ? 1 : 0

  name       = "istiod"
  repository = "https://istio-release.storage.googleapis.com/charts"
  chart      = "istio/istiod"
  version    = var.istio_version
  namespace  = kubernetes_namespace.istio_system[0].metadata[0].name

  depends_on = [helm_release.istio_base]

  values = [
    yamlencode({
      global = {
        proxy = {
          resources = {
            requests = {
              cpu    = "100m"
              memory = "128Mi"
            }
            limits = {
              cpu    = "2000m"
              memory = "1024Mi"
            }
          }
        }
      }

      pilot = {
        resources = {
          requests = {
            cpu    = "500m"
            memory = "2048Mi"
          }
          limits = {
            cpu    = "2000m"
            memory = "4096Mi"
          }
        }
      }
    })
  ]
}

# Istio ingress gateway
resource "helm_release" "istio_ingress" {
  count = var.enable_istio ? 1 : 0

  name       = "istio-ingressgateway"
  repository = "https://istio-release.storage.googleapis.com/charts"
  chart      = "istio/gateway"
  version    = var.istio_version
  namespace  = kubernetes_namespace.istio_system[0].metadata[0].name

  depends_on = [helm_release.istiod]

  values = [
    yamlencode({
      service = {
        type = "LoadBalancer"
        annotations = {
          "service.beta.kubernetes.io/aws-load-balancer-type"                    = "nlb"
          "service.beta.kubernetes.io/aws-load-balancer-cross-zone-load-balancing-enabled" = "true"
          "service.beta.kubernetes.io/aws-load-balancer-ssl-cert"               = var.ssl_certificate_arn
          "service.beta.kubernetes.io/aws-load-balancer-ssl-ports"              = "443"
        }
      }

      resources = {
        requests = {
          cpu    = "100m"
          memory = "128Mi"
        }
        limits = {
          cpu    = "2000m"
          memory = "1024Mi"
        }
      }
    })
  ]
}

# Application namespaces with Istio injection
resource "kubernetes_namespace" "invorto_services" {
  for_each = var.enable_istio ? toset(["api", "realtime", "webhooks", "workers", "telephony"]) : []

  metadata {
    name = "invorto-${each.key}"
    labels = {
      istio-injection = "enabled"
      name            = "invorto-${each.key}"
    }
  }
}

# Istio PeerAuthentication for mTLS
resource "kubernetes_manifest" "peer_authentication" {
  count = var.enable_istio ? 1 : 0

  manifest = {
    apiVersion = "security.istio.io/v1beta1"
    kind       = "PeerAuthentication"

    metadata = {
      name      = "default"
      namespace = "istio-system"
    }

    spec = {
      mtls = {
        mode = "PERMISSIVE"  # Allow both mTLS and plain text traffic during transition
      }
    }
  }

  depends_on = [helm_release.istiod]
}

# Service entries for external services
resource "kubernetes_manifest" "external_services" {
  count = var.enable_istio ? 1 : 0

  manifest = {
    apiVersion = "networking.istio.io/v1beta1"
    kind       = "ServiceEntry"

    metadata = {
      name      = "external-apis"
      namespace = "istio-system"
    }

    spec = {
      hosts = [
        "api.openai.com",
        "api.deepgram.com",
        "api.jambonz.cloud"
      ]

      ports = [
        {
          number   = 443
          name     = "https"
          protocol = "HTTPS"
        }
      ]

      resolution = "DNS"
      location   = "MESH_EXTERNAL"
    }
  }

  depends_on = [helm_release.istiod]
}

# Virtual services for traffic routing
resource "kubernetes_manifest" "api_virtual_service" {
  count = var.enable_istio ? 1 : 0

  manifest = {
    apiVersion = "networking.istio.io/v1beta1"
    kind       = "VirtualService"

    metadata = {
      name      = "invorto-api"
      namespace = "invorto-api"
    }

    spec = {
      hosts = ["api.invorto.ai"]

      http = [
        {
          match = [
            {
              uri = {
                prefix = "/v1"
              }
            }
          ]

          route = [
            {
              destination = {
                host = "invorto-api.invorto-api.svc.cluster.local"
                port = {
                  number = 8080
                }
              }
            }
          ]

          timeout = "30s"
          retries = {
            attempts = 3
            perTryTimeout = "10s"
          }
        },
        {
          match = [
            {
              uri = {
                prefix = "/graphql"
              }
            }
          ]

          route = [
            {
              destination = {
                host = "invorto-api.invorto-api.svc.cluster.local"
                port = {
                  number = 4000
                }
              }
            }
          ]
        }
      ]
    }
  }

  depends_on = [helm_release.istiod]
}

# Destination rules for load balancing and circuit breaking
resource "kubernetes_manifest" "api_destination_rule" {
  count = var.enable_istio ? 1 : 0

  manifest = {
    apiVersion = "networking.istio.io/v1beta1"
    kind       = "DestinationRule"

    metadata = {
      name      = "invorto-api"
      namespace = "invorto-api"
    }

    spec = {
      host = "invorto-api.invorto-api.svc.cluster.local"

      trafficPolicy = {
        loadBalancer = {
          simple = "ROUND_ROBIN"
        }

        connectionPool = {
          tcp = {
            maxConnections = 100
          }
          http = {
            http1MaxPendingRequests  = 10
            http2MaxRequests         = 100
            maxRequestsPerConnection = 10
            maxRetries               = 3
          }
        }

        outlierDetection = {
          consecutive5xxErrors = 3
          interval             = "10s"
          baseEjectionTime     = "30s"
          maxEjectionPercent   = 50
        }
      }
    }
  }

  depends_on = [helm_release.istiod]
}

# Request authentication for JWT validation
resource "kubernetes_manifest" "request_authentication" {
  count = var.enable_istio ? 1 : 0

  manifest = {
    apiVersion = "security.istio.io/v1beta1"
    kind       = "RequestAuthentication"

    metadata = {
      name      = "jwt-auth"
      namespace = "istio-system"
    }

    spec = {
      selector = {
        matchLabels = {
          app = "invorto-api"
        }
      }

      jwtRules = [
        {
          issuer  = var.jwt_issuer
          jwksUri = var.jwks_uri
          audiences = [
            var.jwt_audience
          ]
        }
      ]
    }
  }

  depends_on = [helm_release.istiod]
}

# Authorization policy
resource "kubernetes_manifest" "authorization_policy" {
  count = var.enable_istio ? 1 : 0

  manifest = {
    apiVersion = "security.istio.io/v1beta1"
    kind       = "AuthorizationPolicy"

    metadata = {
      name      = "api-authorization"
      namespace = "invorto-api"
    }

    spec = {
      selector = {
        matchLabels = {
          app = "invorto-api"
        }
      }

      rules = [
        {
          from = [
            {
              source = {
                requestPrincipals = ["*"]
              }
            }
          ]

          to = [
            {
              operation = {
                paths   = ["/health", "/metrics"]
                methods = ["GET"]
              }
            }
          ]
        },
        {
          from = [
            {
              source = {
                requestPrincipals = ["*"]
              }
            }
          ]

          to = [
            {
              operation = {
                paths   = ["/v1/*", "/graphql"]
                methods = ["GET", "POST", "PUT", "PATCH", "DELETE"]
              }
            }
          ]

          when = [
            {
              key    = "request.auth.claims[aud]"
              values = [var.jwt_audience]
            }
          ]
        }
      ]
    }
  }

  depends_on = [helm_release.istiod]
}

# Gateway for external traffic
resource "kubernetes_manifest" "api_gateway" {
  count = var.enable_istio ? 1 : 0

  manifest = {
    apiVersion = "networking.istio.io/v1beta1"
    kind       = "Gateway"

    metadata = {
      name      = "invorto-gateway"
      namespace = "istio-system"
    }

    spec = {
      selector = {
        istio = "ingressgateway"
      }

      servers = [
        {
          port = {
            number   = 443
            name     = "https"
            protocol = "HTTPS"
          }

          tls = {
            mode           = "SIMPLE"
            credentialName = "invorto-tls"
          }

          hosts = ["api.invorto.ai"]
        }
      ]
    }
  }

  depends_on = [helm_release.istio_ingress]
}

# Kiali for service mesh observability
resource "helm_release" "kiali" {
  count = var.enable_kiali ? 1 : 0

  name       = "kiali"
  repository = "https://kiali.org/helm-charts"
  chart      = "kiali-server"
  version    = "1.65.0"
  namespace  = kubernetes_namespace.istio_system[0].metadata[0].name

  depends_on = [helm_release.istiod]

  values = [
    yamlencode({
      auth = {
        strategy = "anonymous"
      }

      external_services = {
        istio = {
          url_service_version = "http://istiod.istio-system:15014/version"
        }
      }
    })
  ]
}

# Jaeger for distributed tracing
resource "helm_release" "jaeger" {
  count = var.enable_jaeger ? 1 : 0

  name       = "jaeger"
  repository = "https://jaegertracing.github.io/helm-charts"
  chart      = "jaeger"
  version    = "0.65.0"
  namespace  = kubernetes_namespace.istio_system[0].metadata[0].name

  depends_on = [helm_release.istiod]

  values = [
    yamlencode({
      allInOne = {
        enabled = true
      }

      storage = {
        type = "memory"
      }

      collector = {
        otlp = {
          enabled = true
        }
      }

      agent = {
        enabled = false  # Istio handles tracing
      }
    })
  ]
}

# Prometheus for metrics collection
resource "helm_release" "prometheus" {
  count = var.enable_prometheus ? 1 : 0

  name       = "prometheus"
  repository = "https://prometheus-community.github.io/helm-charts"
  chart      = "prometheus"
  version    = "19.0.0"
  namespace  = kubernetes_namespace.istio_system[0].metadata[0].name

  depends_on = [helm_release.istiod]

  values = [
    yamlencode({
      server = {
        global = {
          scrape_interval = "15s"
        }
      }

      serviceMonitor = {
        enabled = true
      }
    })
  ]
}