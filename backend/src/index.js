import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import searchBuilderRoutes from './routes/searchBuilder.js';
import rateLimit from 'express-rate-limit';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;
const isProduction = process.env.NODE_ENV === 'production';

// CORS 配置 - 安全設定
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
  : ['http://localhost:3000', 'http://localhost:5173', 'http://127.0.0.1:3000', 'http://127.0.0.1:5173'];

const corsOptions = {
  origin: (origin, callback) => {
    // 允許無 origin 的請求（如行動 app 或 Postman）在開發模式下通過
    if (!origin && !isProduction) {
      return callback(null, true);
    }
    // 生產環境必須檢查 origin
    if (allowedOrigins.includes(origin) || (!isProduction && !origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  optionsSuccessStatus: 200
};

// Rate Limiting 配置
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 分鐘
  max: 100, // 每個 IP 最多 100 次請求
  message: {
    error: 'Too many requests',
    message: '請求過於頻繁，請稍後再試'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// API 端點的更嚴格限制
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 分鐘
  max: 10, // 每個 IP 每分鐘最多 10 次 API 請求
  message: {
    error: 'Too many requests',
    message: 'API 請求過於頻繁，請等待一分鐘後再試'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Middleware
app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' })); // 限制請求大小
app.use(generalLimiter);

// API Routes - 添加 rate limiting
app.use('/api/search-builder', apiLimiter, searchBuilderRoutes);

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

// Error handling middleware - 安全錯誤處理
app.use((err, req, res, next) => {
  // 在伺服器端記錄完整錯誤（用於除錯）
  console.error('Error:', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    timestamp: new Date().toISOString()
  });

  // CORS 錯誤特殊處理
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({
      error: 'Forbidden',
      message: '不允許的來源'
    });
  }

  // 根據環境決定回傳的錯誤訊息
  const statusCode = err.statusCode || 500;
  const response = {
    error: statusCode >= 500 ? 'Internal server error' : 'Request error',
    message: isProduction
      ? '伺服器發生錯誤，請稍後再試'  // 生產環境隱藏詳細錯誤
      : err.message  // 開發環境顯示詳細錯誤
  };

  // 如果有驗證錯誤，可以顯示
  if (err.validationErrors && !isProduction) {
    response.validationErrors = err.validationErrors;
  }

  res.status(statusCode).json(response);
});

app.listen(PORT, () => {
  console.log(`🚀 Reverse-Engineer Searcher running on port ${PORT}`);
});
