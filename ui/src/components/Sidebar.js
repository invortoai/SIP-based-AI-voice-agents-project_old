import React, { useState } from 'react';
import {
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Divider,
  Box,
  Typography,
  Collapse,
  Chip,
  Avatar
} from '@mui/material';
import {
  Dashboard,
  People,
  Call,
  Analytics,
  Settings,
  ExpandLess,
  ExpandMore,
  Phone,
  Assessment,
  Timeline,
  Storage,
  Security,
  Build
} from '@mui/icons-material';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const drawerWidth = 240;

const Sidebar = ({ open, onClose }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, hasPermission } = useAuth();

  const [expandedMenus, setExpandedMenus] = useState({
    agents: false,
    calls: false,
    analytics: false,
    settings: false
  });

  const handleMenuClick = (path) => {
    navigate(path);
    // Close sidebar on mobile after navigation
    if (window.innerWidth < 768) {
      onClose();
    }
  };

  const toggleSubmenu = (menu) => {
    setExpandedMenus(prev => ({
      ...prev,
      [menu]: !prev[menu]
    }));
  };

  const isActive = (path) => {
    return location.pathname === path;
  };

  const menuItems = [
    {
      text: 'Dashboard',
      icon: <Dashboard />,
      path: '/dashboard',
      badge: null
    },
    {
      text: 'Agents',
      icon: <People />,
      submenu: [
        { text: 'All Agents', path: '/agents', icon: <People />, badge: '12' },
        { text: 'Create Agent', path: '/agents/create', icon: <Build /> },
        { text: 'Agent Templates', path: '/agents/templates', icon: <Storage /> }
      ]
    },
    {
      text: 'Calls',
      icon: <Call />,
      submenu: [
        { text: 'Active Calls', path: '/calls/active', icon: <Phone />, badge: '3' },
        { text: 'Call History', path: '/calls/history', icon: <Timeline /> },
        { text: 'Call Analytics', path: '/calls/analytics', icon: <Assessment /> }
      ]
    },
    {
      text: 'Analytics',
      icon: <Analytics />,
      submenu: [
        { text: 'Overview', path: '/analytics/overview', icon: <Analytics /> },
        { text: 'Performance', path: '/analytics/performance', icon: <Assessment /> },
        { text: 'Usage Reports', path: '/analytics/usage', icon: <Timeline /> }
      ]
    }
  ];

  const settingsItems = [
    { text: 'General', path: '/settings/general', icon: <Settings /> },
    { text: 'Security', path: '/settings/security', icon: <Security /> },
    { text: 'Integrations', path: '/settings/integrations', icon: <Build /> }
  ];

  const drawer = (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Logo/Brand */}
      <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Avatar
            sx={{
              bgcolor: 'primary.main',
              width: 40,
              height: 40
            }}
          >
            IA
          </Avatar>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 600, lineHeight: 1.2 }}>
              Invorto AI
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Voice Platform
            </Typography>
          </Box>
        </Box>
      </Box>

      {/* Navigation Menu */}
      <Box sx={{ flexGrow: 1, overflow: 'auto', p: 1 }}>
        <List>
          {menuItems.map((item) => (
            <React.Fragment key={item.text}>
              {item.submenu ? (
                <>
                  <ListItem disablePadding>
                    <ListItemButton
                      onClick={() => toggleSubmenu(item.text.toLowerCase())}
                      sx={{
                        borderRadius: 1,
                        mx: 1,
                        mb: 0.5
                      }}
                    >
                      <ListItemIcon sx={{ color: 'primary.main' }}>
                        {item.icon}
                      </ListItemIcon>
                      <ListItemText primary={item.text} />
                      {expandedMenus[item.text.toLowerCase()] ? <ExpandLess /> : <ExpandMore />}
                    </ListItemButton>
                  </ListItem>

                  <Collapse in={expandedMenus[item.text.toLowerCase()]} timeout="auto" unmountOnExit>
                    <List component="div" disablePadding>
                      {item.submenu.map((subItem) => (
                        <ListItem key={subItem.path} disablePadding>
                          <ListItemButton
                            onClick={() => handleMenuClick(subItem.path)}
                            sx={{
                              pl: 4,
                              borderRadius: 1,
                              mx: 1,
                              mb: 0.5,
                              backgroundColor: isActive(subItem.path) ? 'action.selected' : 'transparent',
                              '&:hover': {
                                backgroundColor: 'action.hover'
                              }
                            }}
                          >
                            <ListItemIcon sx={{ color: 'text.secondary' }}>
                              {subItem.icon}
                            </ListItemIcon>
                            <ListItemText primary={subItem.text} />
                            {subItem.badge && (
                              <Chip
                                label={subItem.badge}
                                size="small"
                                color="primary"
                                sx={{ ml: 1, height: 18, fontSize: '0.7rem' }}
                              />
                            )}
                          </ListItemButton>
                        </ListItem>
                      ))}
                    </List>
                  </Collapse>
                </>
              ) : (
                <ListItem disablePadding>
                  <ListItemButton
                    onClick={() => handleMenuClick(item.path)}
                    sx={{
                      borderRadius: 1,
                      mx: 1,
                      mb: 0.5,
                      backgroundColor: isActive(item.path) ? 'action.selected' : 'transparent',
                      '&:hover': {
                        backgroundColor: 'action.hover'
                      }
                    }}
                  >
                    <ListItemIcon sx={{ color: 'primary.main' }}>
                      {item.icon}
                    </ListItemIcon>
                    <ListItemText primary={item.text} />
                    {item.badge && (
                      <Chip
                        label={item.badge}
                        size="small"
                        color="secondary"
                        sx={{ ml: 1, height: 18, fontSize: '0.7rem' }}
                      />
                    )}
                  </ListItemButton>
                </ListItem>
              )}
            </React.Fragment>
          ))}

          <Divider sx={{ my: 2 }} />

          {/* Settings Section */}
          <ListItem disablePadding>
            <ListItemButton
              onClick={() => toggleSubmenu('settings')}
              sx={{
                borderRadius: 1,
                mx: 1,
                mb: 0.5
              }}
            >
              <ListItemIcon sx={{ color: 'primary.main' }}>
                <Settings />
              </ListItemIcon>
              <ListItemText primary="Settings" />
              {expandedMenus.settings ? <ExpandLess /> : <ExpandMore />}
            </ListItemButton>
          </ListItem>

          <Collapse in={expandedMenus.settings} timeout="auto" unmountOnExit>
            <List component="div" disablePadding>
              {settingsItems.map((item) => (
                <ListItem key={item.path} disablePadding>
                  <ListItemButton
                    onClick={() => handleMenuClick(item.path)}
                    sx={{
                      pl: 4,
                      borderRadius: 1,
                      mx: 1,
                      mb: 0.5,
                      backgroundColor: isActive(item.path) ? 'action.selected' : 'transparent',
                      '&:hover': {
                        backgroundColor: 'action.hover'
                      }
                    }}
                  >
                    <ListItemIcon sx={{ color: 'text.secondary' }}>
                      {item.icon}
                    </ListItemIcon>
                    <ListItemText primary={item.text} />
                  </ListItemButton>
                </ListItem>
              ))}
            </List>
          </Collapse>
        </List>
      </Box>

      {/* Footer */}
      <Box sx={{ p: 2, borderTop: 1, borderColor: 'divider' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <Avatar
            sx={{
              width: 24,
              height: 24,
              bgcolor: user?.role === 'admin' ? 'error.main' : 'primary.main',
              fontSize: '0.75rem'
            }}
          >
            {user?.name?.charAt(0)?.toUpperCase() || 'U'}
          </Avatar>
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <Typography variant="body2" sx={{ fontWeight: 500, lineHeight: 1.2 }}>
              {user?.name || 'User'}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.2 }}>
              {user?.role || 'User'}
            </Typography>
          </Box>
        </Box>

        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'center' }}>
          v2.1.0 • Online
        </Typography>
      </Box>
    </Box>
  );

  return (
    <Drawer
      variant="persistent"
      anchor="left"
      open={open}
      sx={{
        width: drawerWidth,
        flexShrink: 0,
        '& .MuiDrawer-paper': {
          width: drawerWidth,
          boxSizing: 'border-box',
          borderRight: '1px solid',
          borderColor: 'divider'
        },
      }}
      ModalProps={{
        keepMounted: true, // Better open performance on mobile.
      }}
    >
      {drawer}
    </Drawer>
  );
};

export default Sidebar;