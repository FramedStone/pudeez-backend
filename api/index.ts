import express from 'express';
import serverless from 'serverless-http';
import dotenv from 'dotenv';

dotenv.config();

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Simplified CORS for testing
app.use((req, res, next) => {
  const origin = req.headers.origin;
  console.log(`Request received - Origin: ${origin}, Method: ${req.method}, Path: ${req.path}`);
  if (req.method === 'OPTIONS') {
    console.log('Handling OPTIONS preflight request for origin:', origin);
    res.status(200).end();
    return;
  }
  next();
});

// Test route
app.get('/', (req, res) => {
  res.json({ 
    message: 'Pudeez Backend API', 
    version: '1.0.0',
    status: 'running',
    timestamp: new Date().toISOString()
  });
});

// Test API route
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString()
  });
});

// Test Steam profile endpoint (simplified)
app.post('/api/user/get_steam_profile', (req, res) => {
  res.json({ 
    message: 'Steam profile endpoint working',
    timestamp: new Date().toISOString(),
    received: req.body
  });
});

// Catch all other routes
app.use('*', (req, res) => {
  res.status(404).json({ 
    error: 'Route not found',
    method: req.method,
    path: req.originalUrl
  });
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('[Express][Global Error Handler]', err);
    if (res.headersSent) {
        return next(err);
    }
    res.status(500).json({ error: 'Internal Server Error', details: err.message });
});

export default serverless(app);
