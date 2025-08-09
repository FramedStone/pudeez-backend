import express from 'express';
import serverless from 'serverless-http';
import dotenv from 'dotenv';

dotenv.config();

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Simplified CORS for testing
app.use((req, res, next) => {
  // Allow any origin in production, restrict in development if needed
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', process.env.NODE_ENV === 'production' ? '*' : origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Cache-Control, Pragma');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') {
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
