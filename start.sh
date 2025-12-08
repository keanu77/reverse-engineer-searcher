#!/bin/bash

# Reverse-Engineer Searcher 啟動腳本

echo "🚀 Starting Reverse-Engineer Searcher..."

# 檢查 .env 檔案
if [ ! -f "backend/.env" ]; then
    echo "⚠️  請先建立 backend/.env 檔案並設定 OPENAI_API_KEY"
    echo "   範例："
    echo "   cp backend/.env.example backend/.env"
    echo "   然後編輯 .env 檔案填入你的 API keys"
    exit 1
fi

# 啟動後端
echo "📦 Starting backend server..."
cd backend
npm run dev &
BACKEND_PID=$!
cd ..

# 等待後端啟動
sleep 2

# 啟動前端
echo "🎨 Starting frontend dev server..."
cd frontend
npm run dev &
FRONTEND_PID=$!
cd ..

echo ""
echo "✅ Services started!"
echo "   Frontend: http://localhost:3000"
echo "   Backend:  http://localhost:3001"
echo ""
echo "Press Ctrl+C to stop all services"

# 等待中斷信號
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" SIGINT SIGTERM
wait
