import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import searchBuilderRoutes from './routes/searchBuilder.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// API Routes
app.use('/api/search-builder', searchBuilderRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve static files from the React app (production)
const publicPath = join(__dirname, '..', 'public');

// Check if public folder exists (production mode)
if (existsSync(publicPath)) {
  app.use(express.static(publicPath));

  // Handle React routing, return all requests to React app
  app.get('*', (req, res) => {
    res.sendFile(join(publicPath, 'index.html'));
  });
} else {
  // Development mode - just show API info
  app.get('/', (req, res) => {
    res.json({
      message: 'Reverse-Engineer Searcher API',
      status: 'running',
      endpoints: [
        'POST /api/search-builder/from-pmids',
        'POST /api/search-builder/generate-blog',
        'POST /api/search-builder/validate-query',
        'GET /api/search-builder/fetch-article/:pmid',
        'GET /health'
      ]
    });
  });
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Reverse-Engineer Searcher running on port ${PORT}`);
});
