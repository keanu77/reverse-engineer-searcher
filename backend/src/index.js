import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import { logFailure } from './modules/SafeLogging.js';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { existsSync } from 'fs';
import searchBuilderRoutes from './routes/searchBuilder.js';
import rateLimit from 'express-rate-limit';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function createApp() {
  const app = express();
  const isProduction = process.env.NODE_ENV === 'production';

  // CORS 配置 - 安全設定
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
    : ['http://localhost:3000', 'http://localhost:5173', 'http://127.0.0.1:3000', 'http://127.0.0.1:5173'];

  const corsOptions = (req, callback) => {
    const origin = req.get('Origin');
    if (!origin) return callback(null, { origin: false });
    let sameOrigin = false;
    try { sameOrigin = new URL(origin).host === req.get('Host'); } catch { /* reject */ }
    if (sameOrigin || allowedOrigins.includes(origin)) {
      return callback(null, { origin, allowedHeaders: ['Content-Type', 'X-Service-Token'], methods: ['GET', 'POST', 'OPTIONS'] });
    }
    callback(new Error('Not allowed by CORS'));
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

  // Health probes and navigation must work without a browser Origin header.
  app.disable('x-powered-by');
  app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (isProduction) res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
    if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(cors(corsOptions));
  app.use(express.json({ limit: '1mb' })); // 限制請求大小
  app.use(generalLimiter);

  // API Routes - 添加 rate limiting
  app.use('/api/search-builder', apiLimiter, searchBuilderRoutes);

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
    logFailure('http-request', err);

    // CORS 錯誤特殊處理
    if (err.message === 'Not allowed by CORS') {
      return res.status(403).json({
        error: 'Forbidden',
        message: '不允許的來源'
      });
    }

    // 根據環境決定回傳的錯誤訊息
    const statusCode = err.status || err.statusCode || 500;
    const response = {
      error: statusCode >= 500 ? 'Internal server error' : 'Request error',
      message: statusCode >= 500 ? '伺服器發生錯誤，請稍後再試' : '請求格式不正確'
    };

    res.status(statusCode).json(response);
  });

  return app;
}

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  const app = createApp();
  const port = process.env.PORT || 3001;
  app.listen(port, process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1', () => {
    console.log(`Reverse-Engineer Searcher running on port ${port}`);
  });
}
