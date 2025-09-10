import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import CssBaseline from '@mui/material/CssBaseline';
import { Box } from '@mui/material';

// Pages
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';

// Placeholder pages (to be implemented)
const Agents = () => <div>Agents Page - Coming Soon</div>;
const Calls = () => <div>Calls Page - Coming Soon</div>;
const Analytics = () => <div>Analytics Page - Coming Soon</div>;
const Settings = () => <div>Settings Page - Coming Soon</div>;

// Components
import Header from './components/Header';
import Sidebar from './components/Sidebar';

// Context
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ThemeProvider, useTheme } from './contexts/ThemeContext';

function AppContent() {
  const { isAuthenticated, loading } = useAuth();
  const { theme } = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  if (loading) {
    return (
      <Box
        display="flex"
        justifyContent="center"
        alignItems="center"
        minHeight="100vh"
        sx={{
          background: theme.palette.mode === 'dark'
            ? 'linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%)'
            : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
        }}
      >
        <div style={{ color: 'white', fontSize: '18px' }}>Loading Invorto AI...</div>
      </Box>
    );
  }

  if (!isAuthenticated) {
    return <Login />;
  }

  return (
    <Router>
      <Box sx={{ display: 'flex', minHeight: '100vh' }}>
        <Header
          onMenuClick={() => setSidebarOpen(!sidebarOpen)}
          sidebarOpen={sidebarOpen}
        />
        <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <Box
          component="main"
          sx={{
            flexGrow: 1,
            mt: 8,
            ml: sidebarOpen ? '240px' : 0,
            transition: 'margin-left 0.3s ease',
            backgroundColor: theme.palette.background.default,
            minHeight: '100vh'
          }}
        >
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/agents" element={<Agents />} />
            <Route path="/agents/create" element={<Agents />} />
            <Route path="/agents/templates" element={<Agents />} />
            <Route path="/calls/active" element={<Calls />} />
            <Route path="/calls/history" element={<Calls />} />
            <Route path="/calls/analytics" element={<Calls />} />
            <Route path="/analytics/overview" element={<Analytics />} />
            <Route path="/analytics/performance" element={<Analytics />} />
            <Route path="/analytics/usage" element={<Analytics />} />
            <Route path="/settings/general" element={<Settings />} />
            <Route path="/settings/security" element={<Settings />} />
            <Route path="/settings/integrations" element={<Settings />} />
          </Routes>
        </Box>
      </Box>
    </Router>
  );
}

function App() {
  return (
    <ThemeProvider>
      <CssBaseline />
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;