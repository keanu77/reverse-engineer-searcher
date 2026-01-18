import { useState } from 'react';
import axios from 'axios';

/**
 * 錯誤訊息處理
 */
const getErrorMessage = (error) => {
  if (!error.response) {
    if (error.code === 'ECONNABORTED') {
      return { type: 'timeout', message: '請求超時，請檢查網路連線後重試' };
    }
    return { type: 'network', message: '網路連接失敗，請檢查您的網路' };
  }

  const status = error.response.status;
  const data = error.response.data;

  if (status === 400) {
    return { type: 'validation', message: data.message || '輸入格式錯誤' };
  }
  if (status === 404) {
    return { type: 'not_found', message: data.message || '找不到指定的文章' };
  }
  if (status === 429) {
    return { type: 'rate_limit', message: 'API 請求過於頻繁，請等待 30 秒後重試' };
  }
  if (status >= 500) {
    return { type: 'server', message: '伺服器發生錯誤，請稍後再試' };
  }

  return { type: 'unknown', message: data.message || '發生未知錯誤' };
};

/**
 * 自訂 Hook 管理部落格生成
 */
export function useBlogGeneration() {
  const [blogLoading, setBlogLoading] = useState(false);
  const [blogResult, setBlogResult] = useState(null);
  const [blogError, setBlogError] = useState(null);
  const [blogTopic, setBlogTopic] = useState('');

  const generateBlog = async (queryString, goldPmids, llmConfig = null) => {
    setBlogLoading(true);
    setBlogError(null);
    setBlogResult(null);

    try {
      const requestBody = {
        query_string: queryString,
        gold_pmids: goldPmids,
        topic: blogTopic || undefined,
        options: {
          wordCount: '2000-2500',
          language: 'zh-TW'
        }
      };

      if (llmConfig) {
        requestBody.llmConfig = llmConfig;
      }

      const response = await axios.post('/api/search-builder/generate-blog', requestBody);
      setBlogResult(response.data);
      return response.data;
    } catch (err) {
      console.error('Blog generation error:', err);
      const errorInfo = getErrorMessage(err);
      setBlogError(errorInfo.message);
      throw err;
    } finally {
      setBlogLoading(false);
    }
  };

  const resetBlog = () => {
    setBlogResult(null);
    setBlogError(null);
    setBlogTopic('');
  };

  return {
    blogLoading,
    blogResult,
    blogError,
    blogTopic,
    setBlogTopic,
    generateBlog,
    resetBlog
  };
}

export default useBlogGeneration;
