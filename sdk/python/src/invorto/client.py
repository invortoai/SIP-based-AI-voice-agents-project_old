"""Invorto Voice AI Platform - Python Client."""

import json
from typing import Any, Dict, Optional, List, Union
import requests
from pydantic import BaseModel, Field
from datetime import datetime
import asyncio
import websockets
from enum import Enum


class Direction(str, Enum):
    """Call direction enumeration."""
    INBOUND = "inbound"
    OUTBOUND = "outbound"


class CallStatus(str, Enum):
    """Call status enumeration."""
    CREATED = "created"
    RINGING = "ringing"
    ANSWERED = "answered"
    ACTIVE = "active"
    COMPLETED = "completed"
    FAILED = "failed"


class AgentStatus(str, Enum):
    """Agent status enumeration."""
    ACTIVE = "active"
    INACTIVE = "inactive"
    DRAFT = "draft"


class AgentConfig(BaseModel):
    """Configuration for an AI agent."""
    
    name: str
    prompt: str
    voice: Optional[str] = None
    locale: Optional[str] = "en-IN"
    temperature: Optional[float] = 0.7
    model: Optional[str] = "gpt-4o-mini"
    max_tokens: Optional[int] = 1000
    system_prompt: Optional[str] = None
    tools: Optional[List[Dict[str, Any]]] = None
    metadata: Optional[Dict[str, Any]] = None


class CallOptions(BaseModel):
    """Options for starting a call."""
    
    agent_id: str
    to: str
    from_: Optional[str] = Field(None, alias="from")
    direction: Direction = Direction.OUTBOUND
    metadata: Optional[Dict[str, Any]] = None
    recording: Optional[bool] = True
    transcription: Optional[bool] = True


class ListOptions(BaseModel):
    """Options for listing resources."""
    
    page: Optional[int] = 1
    limit: Optional[int] = 50
    search: Optional[str] = None
    status: Optional[str] = None
    sort_by: Optional[str] = None
    sort_order: Optional[str] = "desc"


class CallListOptions(ListOptions):
    """Options for listing calls."""
    
    agent_id: Optional[str] = None
    from_: Optional[str] = Field(None, alias="from")
    to: Optional[str] = None


class PaginatedResponse(BaseModel):
    """Paginated response wrapper."""
    
    data: List[Any]
    pagination: Dict[str, Any]


class Agent(BaseModel):
    """AI agent model."""
    
    id: str
    name: str
    config: AgentConfig
    status: AgentStatus
    tenant_id: str
    created_at: str
    updated_at: str
    stats: Optional[Dict[str, Any]] = None


class Call(BaseModel):
    """Call model."""
    
    id: str
    agent_id: str
    direction: str
    from_num: str
    to_num: str
    status: CallStatus
    started_at: str
    ended_at: Optional[str] = None
    duration: Optional[int] = None
    cost_inr: Optional[float] = None
    metadata: Optional[Dict[str, Any]] = None
    costs: Optional[List[Dict[str, Any]]] = None


class TimelineEvent(BaseModel):
    """Timeline event model."""
    
    id: str
    kind: str
    payload: Any
    timestamp: str


class CallArtifacts(BaseModel):
    """Call artifacts model."""
    
    recording: Optional[str] = None
    transcription: Optional[str] = None
    summary: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


class RealtimeOptions(BaseModel):
    """Real-time connection options."""
    
    audio_format: Optional[str] = "linear16"
    sample_rate: Optional[int] = 16000
    channels: Optional[int] = 1
    enable_recording: Optional[bool] = True
    enable_transcription: Optional[bool] = True


class WebhookConfig(BaseModel):
    """Webhook configuration."""
    
    url: str
    events: List[str]
    secret: Optional[str] = None
    headers: Optional[Dict[str, str]] = None


class TenantUsage(BaseModel):
    """Tenant usage statistics."""
    
    tenant_id: str
    period: str
    calls: Dict[str, Any]
    agents: Dict[str, Any]


class CallAnalytics(BaseModel):
    """Call analytics data."""
    
    call_id: str
    total_events: int
    event_types: Dict[str, int]
    duration: int
    sentiment: str
    topics: List[str]


class InvortoClient:
    """Client for the Invorto Voice AI Platform API."""
    
    def __init__(self, api_key: str, base_url: str = "https://api.invorto.ai", tenant_id: Optional[str] = None):
        """Initialize the client.
        
        Args:
            api_key: Your API key
            base_url: Base URL for the API
            tenant_id: Optional tenant ID for multi-tenancy
        """
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.tenant_id = tenant_id
        self.session = requests.Session()
        self.session.headers.update({
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        })
        
        if tenant_id:
            self.session.headers["x-tenant-id"] = tenant_id
    
    def _make_request(self, method: str, endpoint: str, **kwargs) -> Dict[str, Any]:
        """Make an HTTP request to the API.
        
        Args:
            method: HTTP method
            endpoint: API endpoint
            **kwargs: Additional request parameters
            
        Returns:
            API response as dictionary
            
        Raises:
            requests.HTTPError: If the request fails
        """
        url = f"{self.base_url}{endpoint}"
        response = self.session.request(method, url, **kwargs)
        response.raise_for_status()
        return response.json()
    
    # Agent Management
    def create_agent(self, config: AgentConfig) -> Agent:
        """Create a new AI agent.
        
        Args:
            config: Agent configuration
            
        Returns:
            Created agent
        """
        data = self._make_request(
            "POST", 
            "/v1/agents", 
            json=config.model_dump(exclude_none=True)
        )
        return Agent(**data)
    
    def get_agent(self, agent_id: str) -> Agent:
        """Get agent details.
        
        Args:
            agent_id: Agent ID
            
        Returns:
            Agent details
        """
        data = self._make_request("GET", f"/v1/agents/{agent_id}")
        return Agent(**data)
    
    def list_agents(self, options: Optional[ListOptions] = None) -> PaginatedResponse:
        """List agents with pagination.
        
        Args:
            options: List options
            
        Returns:
            Paginated list of agents
        """
        if options is None:
            options = ListOptions()
        
        params = options.model_dump(exclude_none=True)
        data = self._make_request("GET", "/v1/agents", params=params)
        return PaginatedResponse(**data)
    
    def update_agent(self, agent_id: str, updates: Dict[str, Any]) -> Agent:
        """Update agent configuration.
        
        Args:
            agent_id: Agent ID
            updates: Updates to apply
            
        Returns:
            Updated agent
        """
        data = self._make_request(
            "PATCH", 
            f"/v1/agents/{agent_id}", 
            json=updates
        )
        return Agent(**data)
    
    def delete_agent(self, agent_id: str) -> Dict[str, Any]:
        """Delete an agent.
        
        Args:
            agent_id: Agent ID
            
        Returns:
            Deletion result
        """
        return self._make_request("DELETE", f"/v1/agents/{agent_id}")
    
    # Call Management
    def create_call(self, options: CallOptions) -> Dict[str, Any]:
        """Create a new call.
        
        Args:
            options: Call options
            
        Returns:
            Call details with ID and status
        """
        call_data = options.model_dump(exclude_none=True)
        if options.from_:
            call_data["from"] = options.from_
        
        return self._make_request(
            "POST", 
            "/v1/calls", 
            json=call_data
        )
    
    def get_call(self, call_id: str) -> Call:
        """Get call details.
        
        Args:
            call_id: Call ID
            
        Returns:
            Call details
        """
        data = self._make_request("GET", f"/v1/calls/{call_id}")
        return Call(**data)
    
    def list_calls(self, options: Optional[CallListOptions] = None) -> PaginatedResponse:
        """List calls with filtering and pagination.
        
        Args:
            options: Call list options
            
        Returns:
            Paginated list of calls
        """
        if options is None:
            options = CallListOptions()
        
        params = options.model_dump(exclude_none=True)
        # Handle the 'from' alias
        if "from_" in params:
            params["from"] = params.pop("from_")
        
        data = self._make_request("GET", "/v1/calls", params=params)
        return PaginatedResponse(**data)
    
    def update_call_status(self, call_id: str, status: str, metadata: Optional[Dict[str, Any]] = None) -> Call:
        """Update call status.
        
        Args:
            call_id: Call ID
            status: New status
            metadata: Optional metadata
            
        Returns:
            Updated call
        """
        update_data = {"status": status}
        if metadata:
            update_data["metadata"] = metadata
        
        data = self._make_request(
            "PATCH", 
            f"/v1/calls/{call_id}/status", 
            json=update_data
        )
        return Call(**data)
    
    def get_call_timeline(self, call_id: str) -> List[TimelineEvent]:
        """Get call timeline events.
        
        Args:
            call_id: Call ID
            
        Returns:
            List of timeline events
        """
        data = self._make_request("GET", f"/v1/calls/{call_id}/timeline")
        return [TimelineEvent(**event) for event in data.get("timeline", [])]
    
    def get_call_artifacts(self, call_id: str) -> CallArtifacts:
        """Get call artifacts.
        
        Args:
            call_id: Call ID
            
        Returns:
            Call artifacts
        """
        data = self._make_request("GET", f"/v1/calls/{call_id}/artifacts")
        return CallArtifacts(**data)
    
    # Analytics & Usage
    def get_tenant_usage(self, tenant_id: str, period: str = "24h") -> TenantUsage:
        """Get tenant usage statistics.
        
        Args:
            tenant_id: Tenant ID
            period: Time period (1h, 24h, 7d, 30d, 1m)
            
        Returns:
            Tenant usage data
        """
        data = self._make_request("GET", f"/v1/tenants/{tenant_id}/usage", params={"period": period})
        return TenantUsage(**data)
    
    def get_call_analytics(self, call_id: str) -> CallAnalytics:
        """Get call analytics.
        
        Args:
            call_id: Call ID
            
        Returns:
            Call analytics data
        """
        data = self._make_request("GET", f"/v1/realtime/{call_id}/stats")
        return CallAnalytics(**data)
    
    # Utilities
    def validate_phone_number(self, phone_number: str) -> bool:
        """Validate phone number format.
        
        Args:
            phone_number: Phone number to validate
            
        Returns:
            True if valid, False otherwise
        """
        import re
        # Basic phone number validation
        phone_regex = r'^[\+]?[1-9][\d]{0,15}$'
        cleaned = re.sub(r'[\s\-\(\)]', '', phone_number)
        return bool(re.match(phone_regex, cleaned))
    
    def format_phone_number(self, phone_number: str, country_code: str = "+91") -> str:
        """Format phone number for India.
        
        Args:
            phone_number: Phone number to format
            country_code: Country code prefix
            
        Returns:
            Formatted phone number
        """
        import re
        cleaned = re.sub(r'[\s\-\(\)]', '', phone_number)
        
        if cleaned.startswith('+'):
            return cleaned
        
        if cleaned.startswith('0'):
            return country_code + cleaned[1:]
        
        if cleaned.startswith('91') and len(cleaned) == 12:
            return '+' + cleaned
        
        if len(cleaned) == 10:
            return country_code + cleaned
        
        return phone_number
    
    # Health and monitoring
    def health_check(self) -> Dict[str, Any]:
        """Check API health.
        
        Returns:
            Health status
        """
        return self._make_request("GET", "/health")
    
    def get_metrics(self) -> str:
        """Get Prometheus metrics.
        
        Returns:
            Metrics in Prometheus format
        """
        response = self.session.get(f"{self.base_url}/metrics")
        response.raise_for_status()
        return response.text
    
    # Batch operations
    def create_multiple_agents(self, configs: List[AgentConfig]) -> List[Agent]:
        """Create multiple agents.
        
        Args:
            configs: List of agent configurations
            
        Returns:
            List of created agents
        """
        agents = []
        for config in configs:
            agent = self.create_agent(config)
            agents.append(agent)
        return agents
    
    def create_multiple_calls(self, call_options: List[CallOptions]) -> List[Dict[str, Any]]:
        """Create multiple calls.
        
        Args:
            call_options: List of call options
            
        Returns:
            List of call responses
        """
        calls = []
        for options in call_options:
            call = self.create_call(options)
            calls.append(call)
        return calls
    
    def close(self):
        """Close the client session."""
        self.session.close()
    
    def __enter__(self):
        """Context manager entry."""
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit."""
        self.close()


class AsyncInvortoClient(InvortoClient):
    """Asynchronous client for the Invorto Voice AI Platform API."""
    
    async def create_agent_async(self, config: AgentConfig) -> Agent:
        """Create a new AI agent asynchronously."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self.create_agent, config)
    
    async def get_agent_async(self, agent_id: str) -> Agent:
        """Get agent details asynchronously."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self.get_agent, agent_id)
    
    async def list_agents_async(self, options: Optional[ListOptions] = None) -> PaginatedResponse:
        """List agents asynchronously."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self.list_agents, options)
    
    async def create_call_async(self, options: CallOptions) -> Dict[str, Any]:
        """Create a new call asynchronously."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self.create_call, options)
    
    async def get_call_async(self, call_id: str) -> Call:
        """Get call details asynchronously."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self.get_call, call_id)
    
    async def list_calls_async(self, options: Optional[CallListOptions] = None) -> PaginatedResponse:
        """List calls asynchronously."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self.list_calls, options)

    async def update_call_status_async(self, call_id: str, status: str, metadata: Optional[Dict[str, Any]] = None) -> Call:
        """Update call status asynchronously."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self.update_call_status, call_id, status, metadata)

    async def get_call_timeline_async(self, call_id: str) -> List[TimelineEvent]:
        """Get call timeline asynchronously."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self.get_call_timeline, call_id)

    async def get_call_artifacts_async(self, call_id: str) -> CallArtifacts:
        """Get call artifacts asynchronously."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self.get_call_artifacts, call_id)

    async def get_tenant_usage_async(self, tenant_id: str, period: str = "24h") -> TenantUsage:
        """Get tenant usage asynchronously."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self.get_tenant_usage, tenant_id, period)

    async def get_call_analytics_async(self, call_id: str) -> CallAnalytics:
        """Get call analytics asynchronously."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self.get_call_analytics, call_id)

    async def update_agent_async(self, agent_id: str, updates: Dict[str, Any]) -> Agent:
        """Update agent asynchronously."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self.update_agent, agent_id, updates)

    async def delete_agent_async(self, agent_id: str) -> Dict[str, Any]:
        """Delete agent asynchronously."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self.delete_agent, agent_id)

    async def health_check_async(self) -> Dict[str, Any]:
        """Health check asynchronously."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self.health_check)

    async def get_metrics_async(self) -> str:
        """Get metrics asynchronously."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self.get_metrics)
