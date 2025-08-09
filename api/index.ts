import express, { Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';

// Get env vars
dotenv.config();

const app = express();

// Basic middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Simplified CORS for testing
app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  console.log(`Request received - Origin: ${origin}, Method: ${req.method}, Path: ${req.path}`);
  
  // Handle preflight requests immediately
  if (req.method === 'OPTIONS') {
    console.log('Handling OPTIONS preflight request for origin:', origin);
    res.status(200).end();
    return;
  }
  
  next();
});

// Test route
app.get('/', (req: Request, res: Response) => {
  res.json({ 
    message: 'Pudeez Backend API', 
    version: '1.0.0',
    status: 'running',
    timestamp: new Date().toISOString()
  });
});

// Test API route
app.get('/api/health', (req: Request, res: Response) => {
  res.json({ 
    status: 'healthy',
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString()
  });
});

// Test Steam profile endpoint (simplified)
app.post('/api/user/get_steam_profile', (req: Request, res: Response) => {
  res.json({ 
    message: 'Steam profile endpoint working',
    timestamp: new Date().toISOString(),
    received: req.body
  });
});

// Catch all other routes
app.use('*', (req: Request, res: Response) => {
  res.status(404).json({ 
    error: 'Route not found',
    method: req.method,
    path: req.originalUrl
  });
});

// Global error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    console.error('[Express][Global Error Handler]', err);
    if (res.headersSent) {
        return next(err);
    }
    res.status(500).json({ error: 'Internal Server Error', details: err.message });
});

// Export as Vercel handler
export default app;
