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
  Tabs,
  Tab,
  Badge,
  Tooltip,
  Alert,
  LinearProgress,
  Accordion,
  AccordionSummary,
  AccordionDetails
} from '@mui/material';
import {
  Phone,
  PhoneCallback,
  CallEnd,
  PlayArrow,
  Pause,
  Stop,
  Assessment,
  Timeline,
  ExpandMore,
  Search,
  FilterList,
  Refresh,
  VolumeUp,
  Mic,
  MicOff
} from '@mui/icons-material';
import { useAuth } from '../contexts/AuthContext';

const Calls = () => {
  const { getAuthHeaders } = useAuth();
  const [activeTab, setActiveTab] = useState(0);
  const [calls, setCalls] = useState([]);
  const [activeCalls, setActiveCalls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedCall, setSelectedCall] = useState(null);

  // Mock data for demonstration
  const mockActiveCalls = [
    {
      id: 'call-001',
      agentId: 'agent-1',
      agentName: 'Sales Assistant',
      direction: 'inbound',
      from: '+91 98765 43210',
      to: '+1 555 0123',
      status: 'active',
      startedAt: new Date(Date.now() - 1000 * 60 * 5), // 5 minutes ago
      duration: 300,
      transcription: 'Hello, I\'m calling about your recent inquiry...',
      sentiment: 'positive',
      confidence: 0.92
    },
    {
      id: 'call-002',
      agentId: 'agent-2',
      agentName: 'Technical Support',
      direction: 'outbound',
      from: '+1 555 0124',
      to: '+91 87654 32109',
      status: 'active',
      startedAt: new Date(Date.now() - 1000 * 60 * 2), // 2 minutes ago
      duration: 120,
      transcription: 'I understand you\'re having issues with...',
      sentiment: 'neutral',
      confidence: 0.88
    }
  ];

  const mockCallHistory = [
    {
      id: 'call-003',
      agentId: 'agent-1',
      agentName: 'Sales Assistant',
      direction: 'inbound',
      from: '+91 98765 43211',
      to: '+1 555 0123',
      status: 'completed',
      startedAt: new Date(Date.now() - 1000 * 60 * 60 * 2), // 2 hours ago
      endedAt: new Date(Date.now() - 1000 * 60 * 60 * 2 + 1000 * 60 * 8), // 8 minutes duration
      duration: 480,
      cost: 2.40,
      success: true,
      transcription: 'Thank you for your interest in our services...',
      summary: 'Customer inquired about pricing and features. Provided detailed information and scheduled follow-up call.',
      sentiment: 'positive',
      recordingUrl: 'https://example.com/recordings/call-003.wav'
    },
    {
      id: 'call-004',
      agentId: 'agent-2',
      agentName: 'Technical Support',
      direction: 'inbound',
      from: '+91 87654 32110',
      to: '+1 555 0124',
      status: 'completed',
      startedAt: new Date(Date.now() - 1000 * 60 * 60 * 4), // 4 hours ago
      endedAt: new Date(Date.now() - 1000 * 60 * 60 * 4 + 1000 * 60 * 12), // 12 minutes duration
      duration: 720,
      cost: 3.60,
      success: true,
      transcription: 'I\'m experiencing connectivity issues...',
      summary: 'Customer reported intermittent connection problems. Troubleshot the issue and provided resolution steps.',
      sentiment: 'neutral',
      recordingUrl: 'https://example.com/recordings/call-004.wav'
    },
    {
      id: 'call-005',
      agentId: 'agent-1',
      agentName: 'Sales Assistant',
      direction: 'outbound',
      from: '+1 555 0123',
      to: '+91 98765 43212',
      status: 'failed',
      startedAt: new Date(Date.now() - 1000 * 60 * 60 * 6), // 6 hours ago
      endedAt: new Date(Date.now() - 1000 * 60 * 60 * 6 + 1000 * 30), // 30 seconds duration
      duration: 30,
      cost: 0.15,
      success: false,
      transcription: 'Hello? Hello?',
      summary: 'Call failed - no answer from customer.',
      sentiment: 'neutral'
    }
  ];

  useEffect(() => {
    loadCalls();
  }, [activeTab]);

  const loadCalls = async () => {
    try {
      setLoading(true);
      setError(null);

      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1000));

      if (activeTab === 0) {
        setActiveCalls(mockActiveCalls);
        setCalls([]);
      } else {
        setCalls(mockCallHistory);
        setActiveCalls([]);
      }
    } catch (err) {
      setError('Failed to load calls');
      console.error('Calls loading error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleTabChange = (event, newValue) => {
    setActiveTab(newValue);
  };

  const handleEndCall = async (callId) => {
    try {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 500));

      setActiveCalls(prev => prev.filter(call => call.id !== callId));
    } catch (err) {
      setError('Failed to end call');
    }
  };

  const handleTransferCall = async (callId, newAgentId) => {
    try {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 500));

      setActiveCalls(prev => prev.map(call =>
        call.id === callId
          ? { ...call, agentId: newAgentId, agentName: 'Transferred Agent' }
          : call
      ));
    } catch (err) {
      setError('Failed to transfer call');
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'active':
        return 'success';
      case 'completed':
        return 'primary';
      case 'failed':
        return 'error';
      case 'ringing':
        return 'warning';
      default:
        return 'default';
    }
  };

  const getDirectionIcon = (direction) => {
    return direction === 'inbound' ? <PhoneCallback /> : <Phone />;
  };

  const formatDuration = (seconds) => {
    if (!seconds) return '0:00';

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  };

  const formatTime = (timestamp) => {
    if (!timestamp) return 'N/A';
    return timestamp.toLocaleString();
  };

  const getCurrentDuration = (startedAt) => {
    if (!startedAt) return 0;
    return Math.floor((new Date() - startedAt) / 1000);
  };

  const filteredCalls = (activeTab === 0 ? activeCalls : calls).filter(call => {
    const matchesSearch = call.from.includes(searchTerm) ||
                         call.to.includes(searchTerm) ||
                         call.agentName.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' || call.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  if (loading) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography variant="h4" sx={{ mb: 3 }}>Calls</Typography>
        <LinearProgress />
        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
          Loading calls...
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" sx={{ fontWeight: 600 }}>
          Call Management
        </Typography>
        <Button
          variant="outlined"
          startIcon={<Refresh />}
          onClick={loadCalls}
          sx={{ borderRadius: 2 }}
        >
          Refresh
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {/* Tabs */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        <Tabs value={activeTab} onChange={handleTabChange}>
          <Tab
            label={
              <Badge badgeContent={activeCalls.length} color="error">
                Active Calls
              </Badge>
            }
            icon={<Phone />}
            iconPosition="start"
          />
          <Tab
            label="Call History"
            icon={<Timeline />}
            iconPosition="start"
          />
          <Tab
            label="Analytics"
            icon={<Assessment />}
            iconPosition="start"
          />
        </Tabs>
      </Box>

      {/* Filters */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6}>
          <TextField
            fullWidth
            placeholder="Search calls..."
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
              <MenuItem value="completed">Completed</MenuItem>
              <MenuItem value="failed">Failed</MenuItem>
              <MenuItem value="ringing">Ringing</MenuItem>
            </Select>
          </FormControl>
        </Grid>
      </Grid>

      {/* Active Calls Tab */}
      {activeTab === 0 && (
        <Grid container spacing={3}>
          {filteredCalls.map((call) => (
            <Grid item xs={12} md={6} key={call.id}>
              <Card sx={{
                height: '100%',
                border: 2,
                borderColor: 'success.main',
                position: 'relative'
              }}>
                <Box
                  sx={{
                    position: 'absolute',
                    top: 16,
                    right: 16,
                    width: 12,
                    height: 12,
                    borderRadius: '50%',
                    bgcolor: 'success.main',
                    animation: 'pulse 2s infinite'
                  }}
                />
                <CardContent>
                  <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                    <Avatar sx={{ bgcolor: 'success.main', mr: 2 }}>
                      {getDirectionIcon(call.direction)}
                    </Avatar>
                    <Box sx={{ flexGrow: 1 }}>
                      <Typography variant="h6" sx={{ fontWeight: 600 }}>
                        {call.agentName}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Call #{call.id}
                      </Typography>
                    </Box>
                    <Chip
                      label={call.status}
                      size="small"
                      color={getStatusColor(call.status)}
                    />
                  </Box>

                  <Box sx={{ mb: 2 }}>
                    <Typography variant="body2" color="text.secondary">
                      From: {call.from}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      To: {call.to}
                    </Typography>
                  </Box>

                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
                    <Typography variant="body2" color="text.secondary">
                      Duration:
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 500, color: 'success.main' }}>
                      {formatDuration(getCurrentDuration(call.startedAt))}
                    </Typography>
                  </Box>

                  <Box sx={{ mb: 2 }}>
                    <Typography variant="body2" sx={{ fontWeight: 500, mb: 1 }}>
                      Live Transcription:
                    </Typography>
                    <Typography
                      variant="body2"
                      sx={{
                        bgcolor: 'grey.50',
                        p: 1,
                        borderRadius: 1,
                        fontStyle: 'italic',
                        minHeight: 40
                      }}
                    >
                      {call.transcription || 'Listening...'}
                    </Typography>
                  </Box>

                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <Button
                      size="small"
                      startIcon={<Mic />}
                      variant="outlined"
                      fullWidth
                      sx={{ borderRadius: 1 }}
                    >
                      Mute
                    </Button>
                    <Button
                      size="small"
                      startIcon={<VolumeUp />}
                      variant="outlined"
                      fullWidth
                      sx={{ borderRadius: 1 }}
                    >
                      Hold
                    </Button>
                    <Button
                      size="small"
                      startIcon={<CallEnd />}
                      variant="contained"
                      color="error"
                      fullWidth
                      onClick={() => handleEndCall(call.id)}
                      sx={{ borderRadius: 1 }}
                    >
                      End
                    </Button>
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}

      {/* Call History Tab */}
      {activeTab === 1 && (
        <TableContainer component={Paper} sx={{ borderRadius: 2 }}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Call ID</TableCell>
                <TableCell>Agent</TableCell>
                <TableCell>Direction</TableCell>
                <TableCell>From/To</TableCell>
                <TableCell>Duration</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Cost</TableCell>
                <TableCell>Started</TableCell>
                <TableCell>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredCalls.map((call) => (
                <TableRow key={call.id} hover>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                      {call.id}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center' }}>
                      <Avatar sx={{ width: 24, height: 24, mr: 1 }}>
                        {call.agentName.charAt(0)}
                      </Avatar>
                      {call.agentName}
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center' }}>
                      {getDirectionIcon(call.direction)}
                      <Typography variant="body2" sx={{ ml: 1 }}>
                        {call.direction}
                      </Typography>
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">
                      {call.direction === 'inbound' ? call.from : call.to}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                      {formatDuration(call.duration)}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={call.status}
                      size="small"
                      color={getStatusColor(call.status)}
                    />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                      ₹{call.cost?.toFixed(2) || '0.00'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">
                      {formatTime(call.startedAt)}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', gap: 1 }}>
                      <Tooltip title="View Details">
                        <IconButton
                          size="small"
                          onClick={() => setSelectedCall(call)}
                        >
                          <Assessment />
                        </IconButton>
                      </Tooltip>
                      {call.recordingUrl && (
                        <Tooltip title="Play Recording">
                          <IconButton size="small">
                            <PlayArrow />
                          </IconButton>
                        </Tooltip>
                      )}
                    </Box>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Analytics Tab */}
      {activeTab === 2 && (
        <Grid container spacing={3}>
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>
                  Call Statistics
                </Typography>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                  <Typography variant="body2">Total Calls:</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>1,247</Typography>
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                  <Typography variant="body2">Success Rate:</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 500, color: 'success.main' }}>94.2%</Typography>
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                  <Typography variant="body2">Avg Duration:</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>3:25</Typography>
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Typography variant="body2">Total Cost:</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>₹3,124.50</Typography>
                </Box>
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>
                  Performance Metrics
                </Typography>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                  <Typography variant="body2">Response Time:</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>245ms</Typography>
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                  <Typography variant="body2">Connection Success:</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 500, color: 'success.main' }}>99.8%</Typography>
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                  <Typography variant="body2">Audio Quality:</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>HD</Typography>
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Typography variant="body2">Uptime:</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 500, color: 'success.main' }}>99.9%</Typography>
                </Box>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      {/* Call Details Dialog */}
      {selectedCall && (
        <Dialog
          open={!!selectedCall}
          onClose={() => setSelectedCall(null)}
          maxWidth="md"
          fullWidth
        >
          <DialogTitle>
            Call Details - {selectedCall.id}
          </DialogTitle>
          <DialogContent>
            <Grid container spacing={2} sx={{ mt: 1 }}>
              <Grid item xs={12} sm={6}>
                <Typography variant="body2" color="text.secondary">Agent:</Typography>
                <Typography variant="body1" sx={{ mb: 2 }}>{selectedCall.agentName}</Typography>

                <Typography variant="body2" color="text.secondary">Direction:</Typography>
                <Typography variant="body1" sx={{ mb: 2 }}>{selectedCall.direction}</Typography>

                <Typography variant="body2" color="text.secondary">From:</Typography>
                <Typography variant="body1" sx={{ mb: 2 }}>{selectedCall.from}</Typography>

                <Typography variant="body2" color="text.secondary">To:</Typography>
                <Typography variant="body1" sx={{ mb: 2 }}>{selectedCall.to}</Typography>
              </Grid>

              <Grid item xs={12} sm={6}>
                <Typography variant="body2" color="text.secondary">Status:</Typography>
                <Chip
                  label={selectedCall.status}
                  color={getStatusColor(selectedCall.status)}
                  sx={{ mb: 2 }}
                />

                <Typography variant="body2" color="text.secondary">Duration:</Typography>
                <Typography variant="body1" sx={{ mb: 2 }}>
                  {formatDuration(selectedCall.duration)}
                </Typography>

                <Typography variant="body2" color="text.secondary">Cost:</Typography>
                <Typography variant="body1" sx={{ mb: 2 }}>
                  ₹{selectedCall.cost?.toFixed(2) || '0.00'}
                </Typography>

                <Typography variant="body2" color="text.secondary">Started:</Typography>
                <Typography variant="body1">
                  {formatTime(selectedCall.startedAt)}
                </Typography>
              </Grid>

              {selectedCall.transcription && (
                <Grid item xs={12}>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    Transcription:
                  </Typography>
                  <Paper sx={{ p: 2, bgcolor: 'grey.50' }}>
                    <Typography variant="body2">
                      {selectedCall.transcription}
                    </Typography>
                  </Paper>
                </Grid>
              )}

              {selectedCall.summary && (
                <Grid item xs={12}>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    Summary:
                  </Typography>
                  <Paper sx={{ p: 2, bgcolor: 'grey.50' }}>
                    <Typography variant="body2">
                      {selectedCall.summary}
                    </Typography>
                  </Paper>
                </Grid>
              )}
            </Grid>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setSelectedCall(null)}>Close</Button>
            {selectedCall.recordingUrl && (
              <Button variant="contained" startIcon={<PlayArrow />}>
                Play Recording
              </Button>
            )}
          </DialogActions>
        </Dialog>
      )}
    </Box>
  );
};

export default Calls;