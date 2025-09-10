import React, { useState, useEffect } from 'react';
import {
  Box,
  Grid,
  Card,
  CardContent,
  Typography,
  Button,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Switch,
  FormControlLabel,
  Divider,
  Avatar,
  IconButton,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  Chip,
  LinearProgress
} from '@mui/material';
import {
  Person,
  Security,
  Notifications,
  Palette,
  Storage,
  Build,
  Save,
  Refresh,
  Delete,
  Add,
  Edit,
  Key,
  Webhook,
  Api
} from '@mui/icons-material';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';

const Settings = () => {
  const { user, logout, getAuthHeaders } = useAuth();
  const { isDarkMode, toggleTheme } = useTheme();

  const [activeTab, setActiveTab] = useState('general');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  // Settings state
  const [generalSettings, setGeneralSettings] = useState({
    name: user?.name || '',
    email: user?.email || '',
    timezone: 'Asia/Kolkata',
    language: 'en-IN',
    notifications: true,
    emailUpdates: true
  });

  const [securitySettings, setSecuritySettings] = useState({
    twoFactorEnabled: false,
    sessionTimeout: 30,
    passwordLastChanged: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    loginAlerts: true
  });

  const [apiSettings, setApiSettings] = useState({
    apiKey: 'invorto_****************************',
    webhookUrl: 'https://your-app.com/webhooks/invorto',
    rateLimit: 100,
    retries: 3,
    timeout: 30
  });

  const [webhooks, setWebhooks] = useState([
    {
      id: 'wh-1',
      url: 'https://api.example.com/webhooks/calls',
      events: ['call.completed', 'call.failed'],
      active: true,
      createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    },
    {
      id: 'wh-2',
      url: 'https://slack.example.com/webhooks/invorto',
      events: ['agent.error', 'system.alert'],
      active: true,
      createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
    }
  ]);

  const [createWebhookDialog, setCreateWebhookDialog] = useState(false);
  const [newWebhook, setNewWebhook] = useState({
    url: '',
    events: [],
    active: true
  });

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      setLoading(true);
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (err) {
      setError('Failed to load settings');
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async (section, data) => {
    try {
      setSaving(true);
      setError(null);

      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1000));

      setSuccess(`${section} settings saved successfully`);

      // Clear success message after 3 seconds
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(`Failed to save ${section} settings`);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveGeneral = () => {
    saveSettings('General', generalSettings);
  };

  const handleSaveSecurity = () => {
    saveSettings('Security', securitySettings);
  };

  const handleSaveApi = () => {
    saveSettings('API', apiSettings);
  };

  const handleCreateWebhook = () => {
    const webhook = {
      id: `wh-${Date.now()}`,
      ...newWebhook,
      createdAt: new Date()
    };

    setWebhooks(prev => [...prev, webhook]);
    setNewWebhook({ url: '', events: [], active: true });
    setCreateWebhookDialog(false);
    setSuccess('Webhook created successfully');
    setTimeout(() => setSuccess(null), 3000);
  };

  const handleDeleteWebhook = (webhookId) => {
    setWebhooks(prev => prev.filter(wh => wh.id !== webhookId));
    setSuccess('Webhook deleted successfully');
    setTimeout(() => setSuccess(null), 3000);
  };

  const handleToggleWebhook = (webhookId) => {
    setWebhooks(prev => prev.map(wh =>
      wh.id === webhookId ? { ...wh, active: !wh.active } : wh
    ));
  };

  const regenerateApiKey = async () => {
    try {
      setSaving(true);
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1000));

      setApiSettings(prev => ({
        ...prev,
        apiKey: `invorto_${Math.random().toString(36).substring(2, 15)}${Math.random().toString(36).substring(2, 15)}`
      }));

      setSuccess('API key regenerated successfully');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError('Failed to regenerate API key');
    } finally {
      setSaving(false);
    }
  };

  const tabs = [
    { id: 'general', label: 'General', icon: <Person /> },
    { id: 'security', label: 'Security', icon: <Security /> },
    { id: 'api', label: 'API & Webhooks', icon: <Api /> },
    { id: 'integrations', label: 'Integrations', icon: <Build /> }
  ];

  if (loading) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography variant="h4" sx={{ mb: 3 }}>Settings</Typography>
        <LinearProgress />
        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
          Loading settings...
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" sx={{ fontWeight: 600, mb: 1 }}>
          Settings
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Manage your account settings and preferences
        </Typography>
      </Box>

      {/* Success/Error Messages */}
      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {success && (
        <Alert severity="success" sx={{ mb: 3 }}>
          {success}
        </Alert>
      )}

      <Grid container spacing={3}>
        {/* Sidebar */}
        <Grid item xs={12} md={3}>
          <Card>
            <CardContent>
              <List>
                {tabs.map((tab) => (
                  <ListItem
                    key={tab.id}
                    button
                    selected={activeTab === tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    sx={{
                      borderRadius: 1,
                      mb: 1,
                      '&.Mui-selected': {
                        bgcolor: 'primary.main',
                        color: 'primary.contrastText',
                        '&:hover': {
                          bgcolor: 'primary.dark'
                        }
                      }
                    }}
                  >
                    <Box sx={{ mr: 2 }}>{tab.icon}</Box>
                    <ListItemText primary={tab.label} />
                  </ListItem>
                ))}
              </List>
            </CardContent>
          </Card>
        </Grid>

        {/* Content */}
        <Grid item xs={12} md={9}>
          {/* General Settings */}
          {activeTab === 'general' && (
            <Card>
              <CardContent>
                <Typography variant="h6" sx={{ mb: 3, fontWeight: 600 }}>
                  General Settings
                </Typography>

                <Grid container spacing={3}>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      label="Full Name"
                      value={generalSettings.name}
                      onChange={(e) => setGeneralSettings(prev => ({ ...prev, name: e.target.value }))}
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      label="Email"
                      type="email"
                      value={generalSettings.email}
                      onChange={(e) => setGeneralSettings(prev => ({ ...prev, email: e.target.value }))}
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <FormControl fullWidth>
                      <InputLabel>Timezone</InputLabel>
                      <Select
                        value={generalSettings.timezone}
                        label="Timezone"
                        onChange={(e) => setGeneralSettings(prev => ({ ...prev, timezone: e.target.value }))}
                      >
                        <MenuItem value="Asia/Kolkata">Asia/Kolkata (IST)</MenuItem>
                        <MenuItem value="America/New_York">America/New_York (EST)</MenuItem>
                        <MenuItem value="Europe/London">Europe/London (GMT)</MenuItem>
                        <MenuItem value="Asia/Tokyo">Asia/Tokyo (JST)</MenuItem>
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <FormControl fullWidth>
                      <InputLabel>Language</InputLabel>
                      <Select
                        value={generalSettings.language}
                        label="Language"
                        onChange={(e) => setGeneralSettings(prev => ({ ...prev, language: e.target.value }))}
                      >
                        <MenuItem value="en-IN">English (India)</MenuItem>
                        <MenuItem value="en-US">English (US)</MenuItem>
                        <MenuItem value="hi-IN">Hindi</MenuItem>
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid item xs={12}>
                    <Divider sx={{ my: 2 }} />
                    <Typography variant="h6" sx={{ mb: 2 }}>
                      Preferences
                    </Typography>
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <FormControlLabel
                      control={
                        <Switch
                          checked={generalSettings.notifications}
                          onChange={(e) => setGeneralSettings(prev => ({ ...prev, notifications: e.target.checked }))}
                        />
                      }
                      label="Enable Notifications"
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <FormControlLabel
                      control={
                        <Switch
                          checked={generalSettings.emailUpdates}
                          onChange={(e) => setGeneralSettings(prev => ({ ...prev, emailUpdates: e.target.checked }))}
                        />
                      }
                      label="Email Updates"
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <FormControlLabel
                      control={
                        <Switch
                          checked={isDarkMode}
                          onChange={toggleTheme}
                        />
                      }
                      label="Dark Mode"
                    />
                  </Grid>
                </Grid>

                <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end' }}>
                  <Button
                    variant="contained"
                    startIcon={<Save />}
                    onClick={handleSaveGeneral}
                    disabled={saving}
                  >
                    {saving ? 'Saving...' : 'Save Changes'}
                  </Button>
                </Box>
              </CardContent>
            </Card>
          )}

          {/* Security Settings */}
          {activeTab === 'security' && (
            <Card>
              <CardContent>
                <Typography variant="h6" sx={{ mb: 3, fontWeight: 600 }}>
                  Security Settings
                </Typography>

                <Grid container spacing={3}>
                  <Grid item xs={12}>
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                      <Security sx={{ mr: 2, color: 'primary.main' }} />
                      <Typography variant="h6">Two-Factor Authentication</Typography>
                    </Box>
                    <FormControlLabel
                      control={
                        <Switch
                          checked={securitySettings.twoFactorEnabled}
                          onChange={(e) => setSecuritySettings(prev => ({ ...prev, twoFactorEnabled: e.target.checked }))}
                        />
                      }
                      label="Enable 2FA"
                    />
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                      Add an extra layer of security to your account
                    </Typography>
                  </Grid>

                  <Grid item xs={12} sm={6}>
                    <FormControl fullWidth>
                      <InputLabel>Session Timeout (minutes)</InputLabel>
                      <Select
                        value={securitySettings.sessionTimeout}
                        label="Session Timeout (minutes)"
                        onChange={(e) => setSecuritySettings(prev => ({ ...prev, sessionTimeout: e.target.value }))}
                      >
                        <MenuItem value={15}>15 minutes</MenuItem>
                        <MenuItem value={30}>30 minutes</MenuItem>
                        <MenuItem value={60}>1 hour</MenuItem>
                        <MenuItem value={240}>4 hours</MenuItem>
                      </Select>
                    </FormControl>
                  </Grid>

                  <Grid item xs={12} sm={6}>
                    <FormControlLabel
                      control={
                        <Switch
                          checked={securitySettings.loginAlerts}
                          onChange={(e) => setSecuritySettings(prev => ({ ...prev, loginAlerts: e.target.checked }))}
                        />
                      }
                      label="Login Alerts"
                    />
                    <Typography variant="body2" color="text.secondary">
                      Get notified of new login attempts
                    </Typography>
                  </Grid>

                  <Grid item xs={12}>
                    <Divider sx={{ my: 2 }} />
                    <Typography variant="h6" sx={{ mb: 2 }}>
                      Password & Access
                    </Typography>
                  </Grid>

                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      label="Current Password"
                      type="password"
                      placeholder="Enter current password"
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      label="New Password"
                      type="password"
                      placeholder="Enter new password"
                    />
                  </Grid>

                  <Grid item xs={12}>
                    <Typography variant="body2" color="text.secondary">
                      Last password change: {securitySettings.passwordLastChanged.toLocaleDateString()}
                    </Typography>
                  </Grid>
                </Grid>

                <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end' }}>
                  <Button
                    variant="contained"
                    startIcon={<Save />}
                    onClick={handleSaveSecurity}
                    disabled={saving}
                  >
                    {saving ? 'Saving...' : 'Save Changes'}
                  </Button>
                </Box>
              </CardContent>
            </Card>
          )}

          {/* API & Webhooks Settings */}
          {activeTab === 'api' && (
            <Box>
              {/* API Settings */}
              <Card sx={{ mb: 3 }}>
                <CardContent>
                  <Typography variant="h6" sx={{ mb: 3, fontWeight: 600 }}>
                    API Configuration
                  </Typography>

                  <Grid container spacing={3}>
                    <Grid item xs={12}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        <TextField
                          fullWidth
                          label="API Key"
                          value={apiSettings.apiKey}
                          InputProps={{
                            readOnly: true,
                          }}
                        />
                        <Button
                          variant="outlined"
                          startIcon={<Refresh />}
                          onClick={regenerateApiKey}
                          disabled={saving}
                        >
                          Regenerate
                        </Button>
                      </Box>
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                        Keep this key secure. Regenerating will invalidate the old key.
                      </Typography>
                    </Grid>

                    <Grid item xs={12} sm={6}>
                      <TextField
                        fullWidth
                        label="Rate Limit (requests/minute)"
                        type="number"
                        value={apiSettings.rateLimit}
                        onChange={(e) => setApiSettings(prev => ({ ...prev, rateLimit: parseInt(e.target.value) }))}
                      />
                    </Grid>
                    <Grid item xs={12} sm={6}>
                      <TextField
                        fullWidth
                        label="Timeout (seconds)"
                        type="number"
                        value={apiSettings.timeout}
                        onChange={(e) => setApiSettings(prev => ({ ...prev, timeout: parseInt(e.target.value) }))}
                      />
                    </Grid>
                  </Grid>

                  <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end' }}>
                    <Button
                      variant="contained"
                      startIcon={<Save />}
                      onClick={handleSaveApi}
                      disabled={saving}
                    >
                      {saving ? 'Saving...' : 'Save Changes'}
                    </Button>
                  </Box>
                </CardContent>
              </Card>

              {/* Webhooks */}
              <Card>
                <CardContent>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                    <Typography variant="h6" sx={{ fontWeight: 600 }}>
                      Webhooks
                    </Typography>
                    <Button
                      variant="contained"
                      startIcon={<Add />}
                      onClick={() => setCreateWebhookDialog(true)}
                    >
                      Add Webhook
                    </Button>
                  </Box>

                  <List>
                    {webhooks.map((webhook) => (
                      <ListItem key={webhook.id} divider>
                        <ListItemText
                          primary={
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <Typography variant="body1">{webhook.url}</Typography>
                              <Chip
                                label={webhook.active ? 'Active' : 'Inactive'}
                                size="small"
                                color={webhook.active ? 'success' : 'default'}
                              />
                            </Box>
                          }
                          secondary={
                            <Box>
                              <Typography variant="body2" color="text.secondary">
                                Events: {webhook.events.join(', ')}
                              </Typography>
                              <Typography variant="body2" color="text.secondary">
                                Created: {webhook.createdAt.toLocaleDateString()}
                              </Typography>
                            </Box>
                          }
                        />
                        <ListItemSecondaryAction>
                          <IconButton
                            onClick={() => handleToggleWebhook(webhook.id)}
                            color={webhook.active ? 'success' : 'default'}
                          >
                            {webhook.active ? <Webhook /> : <Webhook sx={{ opacity: 0.5 }} />}
                          </IconButton>
                          <IconButton onClick={() => handleDeleteWebhook(webhook.id)} color="error">
                            <Delete />
                          </IconButton>
                        </ListItemSecondaryAction>
                      </ListItem>
                    ))}
                  </List>
                </CardContent>
              </Card>

              {/* Create Webhook Dialog */}
              <Dialog open={createWebhookDialog} onClose={() => setCreateWebhookDialog(false)} maxWidth="sm" fullWidth>
                <DialogTitle>Create Webhook</DialogTitle>
                <DialogContent>
                  <TextField
                    fullWidth
                    label="Webhook URL"
                    value={newWebhook.url}
                    onChange={(e) => setNewWebhook(prev => ({ ...prev, url: e.target.value }))}
                    sx={{ mt: 2, mb: 2 }}
                  />
                  <FormControl fullWidth sx={{ mb: 2 }}>
                    <InputLabel>Events</InputLabel>
                    <Select
                      multiple
                      value={newWebhook.events}
                      label="Events"
                      onChange={(e) => setNewWebhook(prev => ({ ...prev, events: e.target.value }))}
                      renderValue={(selected) => selected.join(', ')}
                    >
                      <MenuItem value="call.started">Call Started</MenuItem>
                      <MenuItem value="call.completed">Call Completed</MenuItem>
                      <MenuItem value="call.failed">Call Failed</MenuItem>
                      <MenuItem value="agent.error">Agent Error</MenuItem>
                      <MenuItem value="system.alert">System Alert</MenuItem>
                    </Select>
                  </FormControl>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={newWebhook.active}
                        onChange={(e) => setNewWebhook(prev => ({ ...prev, active: e.target.checked }))}
                      />
                    }
                    label="Active"
                  />
                </DialogContent>
                <DialogActions>
                  <Button onClick={() => setCreateWebhookDialog(false)}>Cancel</Button>
                  <Button onClick={handleCreateWebhook} variant="contained">
                    Create
                  </Button>
                </DialogActions>
              </Dialog>
            </Box>
          )}

          {/* Integrations Settings */}
          {activeTab === 'integrations' && (
            <Card>
              <CardContent>
                <Typography variant="h6" sx={{ mb: 3, fontWeight: 600 }}>
                  Integrations
                </Typography>

                <Grid container spacing={3}>
                  <Grid item xs={12}>
                    <Box sx={{ p: 3, border: 1, borderColor: 'divider', borderRadius: 2 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                        <Avatar sx={{ bgcolor: 'primary.main', mr: 2 }}>
                          <Build />
                        </Avatar>
                        <Box>
                          <Typography variant="h6">Deepgram ASR/TTS</Typography>
                          <Typography variant="body2" color="text.secondary">
                            Automatic Speech Recognition and Text-to-Speech
                          </Typography>
                        </Box>
                      </Box>
                      <Chip label="Connected" color="success" size="small" />
                    </Box>
                  </Grid>

                  <Grid item xs={12}>
                    <Box sx={{ p: 3, border: 1, borderColor: 'divider', borderRadius: 2 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                        <Avatar sx={{ bgcolor: 'secondary.main', mr: 2 }}>
                          <Api />
                        </Avatar>
                        <Box>
                          <Typography variant="h6">OpenAI GPT</Typography>
                          <Typography variant="body2" color="text.secondary">
                            Large Language Model for conversation processing
                          </Typography>
                        </Box>
                      </Box>
                      <Chip label="Connected" color="success" size="small" />
                    </Box>
                  </Grid>

                  <Grid item xs={12}>
                    <Box sx={{ p: 3, border: 1, borderColor: 'divider', borderRadius: 2 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                        <Avatar sx={{ bgcolor: 'info.main', mr: 2 }}>
                          <Storage />
                        </Avatar>
                        <Box>
                          <Typography variant="h6">Amazon S3</Typography>
                          <Typography variant="body2" color="text.secondary">
                            File storage for recordings and artifacts
                          </Typography>
                        </Box>
                      </Box>
                      <Chip label="Connected" color="success" size="small" />
                    </Box>
                  </Grid>

                  <Grid item xs={12}>
                    <Box sx={{ p: 3, border: 1, borderColor: 'divider', borderRadius: 2 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                        <Avatar sx={{ bgcolor: 'warning.main', mr: 2 }}>
                          <Key />
                        </Avatar>
                        <Box>
                          <Typography variant="h6">Jambonz</Typography>
                          <Typography variant="body2" color="text.secondary">
                            SIP telephony integration
                          </Typography>
                        </Box>
                      </Box>
                      <Chip label="Connected" color="success" size="small" />
                    </Box>
                  </Grid>
                </Grid>
              </CardContent>
            </Card>
          )}
        </Grid>
      </Grid>
    </Box>
  );
};

export default Settings;