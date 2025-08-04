import express, { Request, Response, NextFunction } from 'express';
import axios from 'axios';
import dotenv from 'dotenv';

// Get env vars
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3111;


// -- Middlewares --
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  next();
});

// Error handling middleware
app.use(
    (
        err: Error,
        req: Request,
        res: Response,
        // gotta love this shit
        // eslint-disable-next-line
        next: NextFunction
    ) => {
      console.error(err.stack);
      res.status(500).json({ error: 'Something went wrong!' });
});

// 404 handler
app.use('/{*any}', (req: Request, res: Response) => {
  res.status(404).json({ error: 'Route not found' });
});


// -- Endpoints --
// Health check
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Root endpoint
app.get('/', (req: Request, res: Response) => {
  res.json({ message: 'Welcome to the Express.js TypeScript API!' });
});

// Get the ZK proof from PROVER_URL
app.post('/api/generate-zkp', (req: Request, res: Response) => {
    axios.post(process.env.PROVER_URL || "", req.body, { headers: { 'Content-Type': 'application/json' } })
        .then(prover_response => res.json(prover_response.data))
        .catch(err => console.error(err));
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Visit http://localhost:${PORT} to get started`);
});

export default app;
