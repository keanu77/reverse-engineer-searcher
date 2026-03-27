import { useState } from "react";
import axios from "axios";
import { getErrorMessage } from "../utils/errorMessages";

/**
 * 自訂 Hook 管理部落格生成
 */
export function useBlogGeneration() {
  const [blogLoading, setBlogLoading] = useState(false);
  const [blogResult, setBlogResult] = useState(null);
  const [blogError, setBlogError] = useState(null);
  const [blogTopic, setBlogTopic] = useState("");

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
          wordCount: "2000-2500",
          language: "zh-TW",
        },
      };

      if (llmConfig) {
        requestBody.llmConfig = llmConfig;
      }

      const response = await axios.post(
        "/api/search-builder/generate-blog",
        requestBody,
      );

      // Handle partial results (search succeeded but article generation failed)
      if (response.data && !response.data.success && !response.data.article) {
        setBlogError(
          `文章生成失敗：${response.data.metadata?.error || "未知錯誤"}。已取得 ${response.data.references?.length || 0} 篇參考文獻。`,
        );
        setBlogResult(response.data);
        return response.data;
      }

      setBlogResult(response.data);
      return response.data;
    } catch (err) {
      console.error("Blog generation error:", err);
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
    setBlogTopic("");
  };

  return {
    blogLoading,
    blogResult,
    blogError,
    blogTopic,
    setBlogTopic,
    generateBlog,
    resetBlog,
  };
}

export default useBlogGeneration;
