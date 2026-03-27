/**
 * 共用錯誤訊息處理 (App.jsx 和 useBlogGeneration 共用)
 */
export const getErrorMessage = (error) => {
  if (!error.response) {
    if (error.code === 'ECONNABORTED') {
      return { type: 'timeout', message: '請求超時，請檢查網路連線後重試' };
    }
    return { type: 'network', message: '網路連接失敗，請檢查您的網路' };
  }

  const status = error.response.status;
  const data = error.response.data;

  if (status === 400) {
    return { type: 'validation', message: data.message || '輸入格式錯誤，請檢查 PMID' };
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
