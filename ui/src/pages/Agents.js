import React, { useState, useEffect } from 'react';
import {
  Box,
  Grid,
  Card,
  CardContent,
  Typography,
  Button,
  Avatar,
  Chip,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Fab,
  Tooltip,
  Alert,
  LinearProgress
} from '@mui/material';
import {
  Add,
  Edit,
  Delete,
  PlayArrow,
  Stop,
  Phone,
  Assessment,
  Settings,
  Search,
  FilterList
} from '@mui/icons-material';
import { useAuth } from '../contexts/AuthContext';

const Agents = () => {
  const { getAuthHeaders } = useAuth();
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState(null);

  // Mock data for demonstration
  const mockAgents = [
    {
      id: 'agent-1',
      name: 'Sales Assistant',
      prompt: 'You are a helpful sales assistant for our company...',
      voice: 'aura-asteria-en',
      status: 'active',
      totalCalls: 245,
      successRate: 92.5,
      avgDuration: 180,
      lastActive: new Date(Date.now() - 1000 * 60 * 30), // 30 minutes ago
      config: {
        temperature: 0.7,
        maxTokens: 1000,
        locale: 'en-IN'
      }
    },
    {
      id: 'agent-2',
      name: 'Technical Support',
      prompt: 'You are a technical support specialist...',
      voice: 'aura-luna-en',
      status: 'active',
      totalCalls: 189,
      successRate: 88.3,
      avgDuration: 240,
      lastActive: new Date(Date.now() - 1000 * 60 * 15), // 15 minutes ago
      config: {
        temperature: 0.6,
        maxTokens: 1200,
        locale: 'en-US'
      }
    },
    {
      id: 'agent-3',
      name: 'Customer Service',
      prompt: 'You are a customer service representative...',
      voice: 'aura-asteria-en',
      status: 'inactive',
      totalCalls: 156,
      successRate: 91.2,
      avgDuration: 165,
      lastActive: new Date(Date.now() - 1000 * 60 * 60 * 2), // 2 hours ago
      config: {
        temperature: 0.8,
        maxTokens: 800,
        locale: 'en-IN'
      }
    }
  ];

  useEffect(() => {
    loadAgents();
  }, []);

  const loadAgents = async () => {
    try {
      setLoading(true);
      setError(null);

      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1000));
      setAgents(mockAgents);
    } catch (err) {
      setError('Failed to load agents');
      console.error('Agents loading error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateAgent = async (agentData) => {
    try {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 500));

      const newAgent = {
        id: `agent-${Date.now()}`,
        ...agentData,
        status: 'draft',
        totalCalls: 0,
        successRate: 0,
        avgDuration: 0,
        lastActive: null,
        config: {
          temperature: agentData.temperature || 0.7,
          maxTokens: agentData.maxTokens || 1000,
          locale: agentData.locale || 'en-IN'
        }
      };

      setAgents(prev => [...prev, newAgent]);
      setCreateDialogOpen(false);
    } catch (err) {
      setError('Failed to create agent');
    }
  };

  const handleToggleAgent = async (agentId) => {
    try {
      const agent = agents.find(a => a.id === agentId);
      if (!agent) return;

      const newStatus = agent.status === 'active' ? 'inactive' : 'active';

      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 300));

      setAgents(prev => prev.map(a =>
        a.id === agentId
          ? { ...a, status: newStatus, lastActive: new Date() }
          : a
      ));
    } catch (err) {
      setError('Failed to update agent status');
    }
  };

  const handleDeleteAgent = async (agentId) => {
    try {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 300));

      setAgents(prev => prev.filter(a => a.id !== agentId));
    } catch (err) {
      setError('Failed to delete agent');
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'active':
        return 'success';
      case 'inactive':
        return 'default';
      case 'draft':
        return 'warning';
      default:
        return 'default';
    }
  };

  const formatDuration = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatLastActive = (timestamp) => {
    if (!timestamp) return 'Never';

    const now = new Date();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / (1000 * 60));

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;

    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  const filteredAgents = agents.filter(agent => {
    const matchesSearch = agent.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         agent.prompt.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' || agent.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  if (loading) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography variant="h4" sx={{ mb: 3 }}>Agents</Typography>
        <LinearProgress />
        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
          Loading agents...
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" sx={{ fontWeight: 600 }}>
          AI Agents
        </Typography>
        <Button
          variant="contained"
          startIcon={<Add />}
          onClick={() => setCreateDialogOpen(true)}
          sx={{ borderRadius: 2 }}
        >
          Create Agent
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {/* Filters */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6}>
          <TextField
            fullWidth
            placeholder="Search agents..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            InputProps={{
              startAdornment: <Search sx={{ color: 'text.secondary', mr: 1 }} />
            }}
            sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
          />
        </Grid>
        <Grid item xs={12} sm={6}>
          <FormControl fullWidth>
            <InputLabel>Status</InputLabel>
            <Select
              value={statusFilter}
              label="Status"
              onChange={(e) => setStatusFilter(e.target.value)}
              sx={{ borderRadius: 2 }}
            >
              <MenuItem value="all">All Status</MenuItem>
              <MenuItem value="active">Active</MenuItem>
              <MenuItem value="inactive">Inactive</MenuItem>
              <MenuItem value="draft">Draft</MenuItem>
            </Select>
          </FormControl>
        </Grid>
      </Grid>

      {/* Agents Grid */}
      <Grid container spacing={3}>
        {filteredAgents.map((agent) => (
          <Grid item xs={12} md={6} lg={4} key={agent.id}>
            <Card sx={{
              height: '100%',
              cursor: 'pointer',
              transition: 'transform 0.2s, box-shadow 0.2s',
              '&:hover': {
                transform: 'translateY(-4px)',
                boxShadow: (theme) => theme.shadows[8]
              }
            }}>
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                  <Avatar
                    sx={{
                      bgcolor: agent.status === 'active' ? 'success.main' : 'grey.400',
                      mr: 2,
                      width: 48,
                      height: 48
                    }}
                  >
                    {agent.name.charAt(0).toUpperCase()}
                  </Avatar>
                  <Box sx={{ flexGrow: 1 }}>
                    <Typography variant="h6" sx={{ fontWeight: 600 }}>
                      {agent.name}
                    </Typography>
                    <Chip
                      label={agent.status}
                      size="small"
                      color={getStatusColor(agent.status)}
                      variant="outlined"
                    />
                  </Box>
                  <Box>
                    <Tooltip title={agent.status === 'active' ? 'Stop Agent' : 'Start Agent'}>
                      <IconButton
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleAgent(agent.id);
                        }}
                        color={agent.status === 'active' ? 'success' : 'default'}
                      >
                        {agent.status === 'active' ? <Stop /> : <PlayArrow />}
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Edit Agent">
                      <IconButton
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedAgent(agent);
                        }}
                      >
                        <Edit />
                      </IconButton>
                    </Tooltip>
                  </Box>
                </Box>

                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{
                    mb: 2,
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden'
                  }}
                >
                  {agent.prompt}
                </Typography>

                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                  <Typography variant="body2" color="text.secondary">
                    Voice:
                  </Typography>
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                    {agent.voice}
                  </Typography>
                </Box>

                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
                  <Typography variant="body2" color="text.secondary">
                    Last Active:
                  </Typography>
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                    {formatLastActive(agent.lastActive)}
                  </Typography>
                </Box>

                {/* Performance Metrics */}
                <Box sx={{ borderTop: 1, borderColor: 'divider', pt: 2 }}>
                  <Grid container spacing={1}>
                    <Grid item xs={4}>
                      <Box sx={{ textAlign: 'center' }}>
                        <Typography variant="h6" sx={{ fontWeight: 600, color: 'primary.main' }}>
                          {agent.totalCalls}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          Calls
                        </Typography>
                      </Box>
                    </Grid>
                    <Grid item xs={4}>
                      <Box sx={{ textAlign: 'center' }}>
                        <Typography variant="h6" sx={{ fontWeight: 600, color: 'success.main' }}>
                          {agent.successRate}%
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          Success
                        </Typography>
                      </Box>
                    </Grid>
                    <Grid item xs={4}>
                      <Box sx={{ textAlign: 'center' }}>
                        <Typography variant="h6" sx={{ fontWeight: 600, color: 'info.main' }}>
                          {formatDuration(agent.avgDuration)}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          Avg Duration
                        </Typography>
                      </Box>
                    </Grid>
                  </Grid>
                </Box>

                {/* Action Buttons */}
                <Box sx={{ display: 'flex', gap: 1, mt: 2 }}>
                  <Button
                    size="small"
                    startIcon={<Phone />}
                    variant="outlined"
                    fullWidth
                    sx={{ borderRadius: 1 }}
                  >
                    Test Call
                  </Button>
                  <Button
                    size="small"
                    startIcon={<Assessment />}
                    variant="outlined"
                    fullWidth
                    sx={{ borderRadius: 1 }}
                  >
                    Analytics
                  </Button>
                </Box>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      {/* Floating Action Button */}
      <Fab
        color="primary"
        aria-label="add agent"
        sx={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          zIndex: 1000
        }}
        onClick={() => setCreateDialogOpen(true)}
      >
        <Add />
      </Fab>

      {/* Create Agent Dialog */}
      <CreateAgentDialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        onCreate={handleCreateAgent}
      />

      {/* Edit Agent Dialog */}
      {selectedAgent && (
        <EditAgentDialog
          open={!!selectedAgent}
          agent={selectedAgent}
          onClose={() => setSelectedAgent(null)}
          onUpdate={(updatedAgent) => {
            setAgents(prev => prev.map(a =>
              a.id === updatedAgent.id ? updatedAgent : a
            ));
            setSelectedAgent(null);
          }}
        />
      )}
    </Box>
  );
};

// Create Agent Dialog Component
const CreateAgentDialog = ({ open, onClose, onCreate }) => {
  const [formData, setFormData] = useState({
    name: '',
    prompt: '',
    voice: 'aura-asteria-en',
    temperature: 0.7,
    maxTokens: 1000,
    locale: 'en-IN'
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onCreate(formData);
    setFormData({
      name: '',
      prompt: '',
      voice: 'aura-asteria-en',
      temperature: 0.7,
      maxTokens: 1000,
      locale: 'en-IN'
    });
  };

  const handleChange = (field) => (e) => {
    setFormData(prev => ({
      ...prev,
      [field]: e.target.value
    }));
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Create New Agent</DialogTitle>
      <DialogContent>
        <Box component="form" onSubmit={handleSubmit} sx={{ mt: 2 }}>
          <Grid container spacing={2}>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Agent Name"
                value={formData.name}
                onChange={handleChange('name')}
                required
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="System Prompt"
                value={formData.prompt}
                onChange={handleChange('prompt')}
                multiline
                rows={4}
                required
                placeholder="Describe the agent's role and behavior..."
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>Voice</InputLabel>
                <Select
                  value={formData.voice}
                  label="Voice"
                  onChange={handleChange('voice')}
                >
                  <MenuItem value="aura-asteria-en">Aura Asteria (English)</MenuItem>
                  <MenuItem value="aura-luna-en">Aura Luna (English)</MenuItem>
                  <MenuItem value="aura-stella-en">Aura Stella (English)</MenuItem>
                  <MenuItem value="aura-zeus-en">Aura Zeus (English)</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>Locale</InputLabel>
                <Select
                  value={formData.locale}
                  label="Locale"
                  onChange={handleChange('locale')}
                >
                  <MenuItem value="en-IN">English (India)</MenuItem>
                  <MenuItem value="en-US">English (US)</MenuItem>
                  <MenuItem value="en-GB">English (UK)</MenuItem>
                  <MenuItem value="hi-IN">Hindi (India)</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Temperature"
                type="number"
                value={formData.temperature}
                onChange={handleChange('temperature')}
                inputProps={{ min: 0, max: 2, step: 0.1 }}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Max Tokens"
                type="number"
                value={formData.maxTokens}
                onChange={handleChange('maxTokens')}
                inputProps={{ min: 100, max: 4000, step: 100 }}
              />
            </Grid>
          </Grid>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={handleSubmit} variant="contained">
          Create Agent
        </Button>
      </DialogActions>
    </Dialog>
  );
};

// Edit Agent Dialog Component
const EditAgentDialog = ({ open, agent, onClose, onUpdate }) => {
  const [formData, setFormData] = useState(agent || {});

  useEffect(() => {
    if (agent) {
      setFormData(agent);
    }
  }, [agent]);

  const handleSubmit = (e) => {
    e.preventDefault();
    onUpdate(formData);
  };

  const handleChange = (field) => (e) => {
    setFormData(prev => ({
      ...prev,
      [field]: e.target.value
    }));
  };

  if (!agent) return null;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Edit Agent</DialogTitle>
      <DialogContent>
        <Box component="form" onSubmit={handleSubmit} sx={{ mt: 2 }}>
          <Grid container spacing={2}>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Agent Name"
                value={formData.name || ''}
                onChange={handleChange('name')}
                required
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="System Prompt"
                value={formData.prompt || ''}
                onChange={handleChange('prompt')}
                multiline
                rows={4}
                required
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>Voice</InputLabel>
                <Select
                  value={formData.voice || 'aura-asteria-en'}
                  label="Voice"
                  onChange={handleChange('voice')}
                >
                  <MenuItem value="aura-asteria-en">Aura Asteria (English)</MenuItem>
                  <MenuItem value="aura-luna-en">Aura Luna (English)</MenuItem>
                  <MenuItem value="aura-stella-en">Aura Stella (English)</MenuItem>
                  <MenuItem value="aura-zeus-en">Aura Zeus (English)</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>Status</InputLabel>
                <Select
                  value={formData.status || 'draft'}
                  label="Status"
                  onChange={handleChange('status')}
                >
                  <MenuItem value="active">Active</MenuItem>
                  <MenuItem value="inactive">Inactive</MenuItem>
                  <MenuItem value="draft">Draft</MenuItem>
                </Select>
              </FormControl>
            </Grid>
          </Grid>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={handleSubmit} variant="contained">
          Update Agent
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default Agents;