import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import swaggerUi from 'swagger-ui-express';
import { openApiSpec } from './openapi';
import authRoutes from './routes/auth';
import ticketRoutes from './routes/tickets';
import categoryRoutes from './routes/categories';
import statusRoutes from './routes/statuses';
import organizationRoutes from './routes/organizations';
import adminRoutes from './routes/admin';
import notificationRoutes from './routes/notifications';
import reportRoutes from './routes/reports';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Normalize FRONTEND_URL to remove trailing slash for CORS matching
const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
const normalizedFrontendUrl = frontendUrl.replace(/\/$/, ''); // Remove trailing slash

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) {
      return callback(null, true);
    }
    
    // Normalize the origin to remove trailing slash for comparison
    const normalizedOrigin = origin.replace(/\/$/, '');
    
    // Check if the normalized origin matches the normalized frontend URL
    if (normalizedOrigin === normalizedFrontendUrl) {
      callback(null, true);
    } else {
      // In development, allow localhost origins
      if (process.env.NODE_ENV !== 'production' && origin.includes('localhost')) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    }
  },
  credentials: true,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve uploaded files
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/organizations', organizationRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/statuses', statusRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/reports', reportRoutes);

// API Documentation (Swagger UI)
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiSpec));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

