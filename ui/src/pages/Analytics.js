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
  LinearProgress,
  Alert,
  Divider
} from '@mui/material';
import {
  TrendingUp,
  TrendingDown,
  Assessment,
  Timeline,
  BarChart,
  PieChart,
  Download,
  Refresh,
  DateRange,
  FilterList
} from '@mui/icons-material';
import { useAuth } from '../contexts/AuthContext';

const Analytics = () => {
  const { getAuthHeaders } = useAuth();
  const [activeTab, setActiveTab] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dateRange, setDateRange] = useState('7d');
  const [analyticsData, setAnalyticsData] = useState(null);

  // Mock analytics data
  const mockAnalyticsData = {
    overview: {
      totalCalls: 1247,
      totalDuration: 345600, // seconds
      totalCost: 3124.50,
      successRate: 94.2,
      avgCallDuration: 277, // seconds
      activeAgents: 8,
      totalAgents: 12
    },
    trends: {
      calls: [
        { date: '2024-01-01', calls: 45, duration: 12400, cost: 62.00 },
        { date: '2024-01-02', calls: 52, duration: 14200, cost: 71.00 },
        { date: '2024-01-03', calls: 48, duration: 13100, cost: 65.50 },
        { date: '2024-01-04', calls: 61, duration: 16800, cost: 84.00 },
        { date: '2024-01-05', calls: 55, duration: 15100, cost: 75.50 },
        { date: '2024-01-06', calls: 49, duration: 13400, cost: 67.00 },
        { date: '2024-01-07', calls: 58, duration: 15900, cost: 79.50 }
      ],
      performance: {
        responseTime: [245, 238, 252, 241, 235, 248, 242],
        successRate: [94.2, 93.8, 94.5, 94.1, 93.9, 94.3, 94.0],
        audioQuality: [98.5, 98.7, 98.3, 98.6, 98.4, 98.5, 98.2]
      }
    },
    agents: [
      {
        id: 'agent-1',
        name: 'Sales Assistant',
        calls: 245,
        successRate: 96.3,
        avgDuration: 285,
        totalCost: 1222.50,
        trend: 'up'
      },
      {
        id: 'agent-2',
        name: 'Technical Support',
        calls: 189,
        successRate: 92.1,
        avgDuration: 320,
        totalCost: 945.00,
        trend: 'up'
      },
      {
        id: 'agent-3',
        name: 'Customer Service',
        calls: 156,
        successRate: 93.6,
        avgDuration: 245,
        totalCost: 780.00,
        trend: 'down'
      }
    ],
    calls: [
      {
        id: 'call-001',
        agentName: 'Sales Assistant',
        duration: 480,
        cost: 2.40,
        sentiment: 'positive',
        success: true,
        timestamp: new Date(Date.now() - 1000 * 60 * 30)
      },
      {
        id: 'call-002',
        agentName: 'Technical Support',
        duration: 720,
        cost: 3.60,
        sentiment: 'neutral',
        success: true,
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2)
      },
      {
        id: 'call-003',
        agentName: 'Customer Service',
        duration: 240,
        cost: 1.20,
        sentiment: 'negative',
        success: false,
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 4)
      }
    ]
  };

  useEffect(() => {
    loadAnalytics();
  }, [dateRange]);

  const loadAnalytics = async () => {
    try {
      setLoading(true);
      setError(null);

      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1500));
      setAnalyticsData(mockAnalyticsData);
    } catch (err) {
      setError('Failed to load analytics data');
      console.error('Analytics loading error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleTabChange = (event, newValue) => {
    setActiveTab(newValue);
  };

  const formatDuration = (seconds) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  };

  const formatCurrency = (amount) => {
    return `₹${amount.toFixed(2)}`;
  };

  const getSentimentColor = (sentiment) => {
    switch (sentiment) {
      case 'positive':
        return 'success';
      case 'neutral':
        return 'warning';
      case 'negative':
        return 'error';
      default:
        return 'default';
    }
  };

  const getTrendIcon = (trend) => {
    return trend === 'up' ?
      <TrendingUp sx={{ color: 'success.main' }} /> :
      <TrendingDown sx={{ color: 'error.main' }} />;
  };

  if (loading) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography variant="h4" sx={{ mb: 3 }}>Analytics</Typography>
        <LinearProgress />
        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
          Loading analytics data...
        </Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography variant="h4" sx={{ mb: 3 }}>Analytics</Typography>
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
        <Button startIcon={<Refresh />} onClick={loadAnalytics}>
          Retry
        </Button>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" sx={{ fontWeight: 600 }}>
          Analytics Dashboard
        </Typography>
        <Box sx={{ display: 'flex', gap: 2 }}>
          <FormControl size="small">
            <InputLabel>Date Range</InputLabel>
            <Select
              value={dateRange}
              label="Date Range"
              onChange={(e) => setDateRange(e.target.value)}
            >
              <MenuItem value="1d">Last 24 Hours</MenuItem>
              <MenuItem value="7d">Last 7 Days</MenuItem>
              <MenuItem value="30d">Last 30 Days</MenuItem>
              <MenuItem value="90d">Last 90 Days</MenuItem>
            </Select>
          </FormControl>
          <Button
            variant="outlined"
            startIcon={<Download />}
            sx={{ borderRadius: 2 }}
          >
            Export
          </Button>
          <Button
            variant="outlined"
            startIcon={<Refresh />}
            onClick={loadAnalytics}
            sx={{ borderRadius: 2 }}
          >
            Refresh
          </Button>
        </Box>
      </Box>

      {/* Overview Cards */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <Avatar sx={{ bgcolor: 'primary.main', mr: 2 }}>
                  <Assessment />
                </Avatar>
                <Box>
                  <Typography variant="h4" sx={{ fontWeight: 600 }}>
                    {analyticsData.overview.totalCalls.toLocaleString()}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Total Calls
                  </Typography>
                </Box>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <TrendingUp sx={{ color: 'success.main', mr: 1 }} />
                <Typography variant="body2" color="success.main">
                  +12.5% from last period
                </Typography>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <Avatar sx={{ bgcolor: 'success.main', mr: 2 }}>
                  <Timeline />
                </Avatar>
                <Box>
                  <Typography variant="h4" sx={{ fontWeight: 600 }}>
                    {formatDuration(analyticsData.overview.avgCallDuration)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Avg Duration
                  </Typography>
                </Box>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <TrendingDown sx={{ color: 'success.main', mr: 1 }} />
                <Typography variant="body2" color="success.main">
                  -8.2% from last period
                </Typography>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <Avatar sx={{ bgcolor: 'warning.main', mr: 2 }}>
                  <BarChart />
                </Avatar>
                <Box>
                  <Typography variant="h4" sx={{ fontWeight: 600 }}>
                    {analyticsData.overview.successRate}%
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Success Rate
                  </Typography>
                </Box>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <TrendingUp sx={{ color: 'success.main', mr: 1 }} />
                <Typography variant="body2" color="success.main">
                  +2.1% from last period
                </Typography>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <Avatar sx={{ bgcolor: 'info.main', mr: 2 }}>
                  <PieChart />
                </Avatar>
                <Box>
                  <Typography variant="h4" sx={{ fontWeight: 600 }}>
                    {formatCurrency(analyticsData.overview.totalCost)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Total Cost
                  </Typography>
                </Box>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <TrendingDown sx={{ color: 'success.main', mr: 1 }} />
                <Typography variant="body2" color="success.main">
                  -5.3% from last period
                </Typography>
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Tabs */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        <Tabs value={activeTab} onChange={handleTabChange}>
          <Tab label="Performance Trends" />
          <Tab label="Agent Analytics" />
          <Tab label="Call Details" />
        </Tabs>
      </Box>

      {/* Performance Trends Tab */}
      {activeTab === 0 && (
        <Grid container spacing={3}>
          <Grid item xs={12}>
            <Card>
              <CardContent>
                <Typography variant="h6" sx={{ mb: 3, fontWeight: 600 }}>
                  Call Volume Trends
                </Typography>
                <Box sx={{ height: 300, display: 'flex', alignItems: 'end', gap: 1 }}>
                  {analyticsData.trends.calls.map((day, index) => (
                    <Box
                      key={day.date}
                      sx={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        flex: 1
                      }}
                    >
                      <Box
                        sx={{
                          width: '100%',
                          maxWidth: 40,
                          height: `${(day.calls / 70) * 200}px`,
                          bgcolor: 'primary.main',
                          borderRadius: '4px 4px 0 0',
                          mb: 1,
                          transition: 'all 0.3s ease',
                          '&:hover': {
                            bgcolor: 'primary.dark',
                            transform: 'scale(1.05)'
                          }
                        }}
                      />
                      <Typography variant="caption" sx={{ transform: 'rotate(-45deg)', fontSize: '0.7rem' }}>
                        {new Date(day.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </Typography>
                    </Box>
                  ))}
                </Box>
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>
                  Response Time Trend
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'end', gap: 1, height: 150 }}>
                  {analyticsData.trends.performance.responseTime.map((time, index) => (
                    <Box
                      key={index}
                      sx={{
                        width: '100%',
                        maxWidth: 30,
                        height: `${(time / 300) * 120}px`,
                        bgcolor: 'success.main',
                        borderRadius: '2px'
                      }}
                    />
                  ))}
                </Box>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  Average: 242ms
                </Typography>
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>
                  Success Rate Trend
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'end', gap: 1, height: 150 }}>
                  {analyticsData.trends.performance.successRate.map((rate, index) => (
                    <Box
                      key={index}
                      sx={{
                        width: '100%',
                        maxWidth: 30,
                        height: `${rate * 1.2}px`,
                        bgcolor: 'warning.main',
                        borderRadius: '2px'
                      }}
                    />
                  ))}
                </Box>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  Current: {analyticsData.overview.successRate}%
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      {/* Agent Analytics Tab */}
      {activeTab === 1 && (
        <TableContainer component={Paper} sx={{ borderRadius: 2 }}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Agent</TableCell>
                <TableCell align="right">Calls</TableCell>
                <TableCell align="right">Success Rate</TableCell>
                <TableCell align="right">Avg Duration</TableCell>
                <TableCell align="right">Total Cost</TableCell>
                <TableCell align="center">Trend</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {analyticsData.agents.map((agent) => (
                <TableRow key={agent.id} hover>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center' }}>
                      <Avatar sx={{ width: 32, height: 32, mr: 2 }}>
                        {agent.name.charAt(0)}
                      </Avatar>
                      <Typography variant="body1" sx={{ fontWeight: 500 }}>
                        {agent.name}
                      </Typography>
                    </Box>
                  </TableCell>
                  <TableCell align="right">
                    <Typography variant="body1" sx={{ fontWeight: 500 }}>
                      {agent.calls}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Chip
                      label={`${agent.successRate}%`}
                      size="small"
                      color={agent.successRate >= 95 ? 'success' : agent.successRate >= 90 ? 'warning' : 'error'}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <Typography variant="body1">
                      {formatDuration(agent.avgDuration)}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Typography variant="body1" sx={{ fontWeight: 500 }}>
                      {formatCurrency(agent.totalCost)}
                    </Typography>
                  </TableCell>
                  <TableCell align="center">
                    {getTrendIcon(agent.trend)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Call Details Tab */}
      {activeTab === 2 && (
        <TableContainer component={Paper} sx={{ borderRadius: 2 }}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Call ID</TableCell>
                <TableCell>Agent</TableCell>
                <TableCell align="right">Duration</TableCell>
                <TableCell align="right">Cost</TableCell>
                <TableCell>Sentiment</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Timestamp</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {analyticsData.calls.map((call) => (
                <TableRow key={call.id} hover>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                      {call.id}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body1">
                      {call.agentName}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Typography variant="body1">
                      {formatDuration(call.duration)}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Typography variant="body1" sx={{ fontWeight: 500 }}>
                      {formatCurrency(call.cost)}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={call.sentiment}
                      size="small"
                      color={getSentimentColor(call.sentiment)}
                    />
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={call.success ? 'Success' : 'Failed'}
                      size="small"
                      color={call.success ? 'success' : 'error'}
                    />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {call.timestamp.toLocaleString()}
                    </Typography>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
};

export default Analytics;