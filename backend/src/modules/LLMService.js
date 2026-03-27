import { LLMClient } from './LLMClient.js';
import { TermClassifier } from './TermClassifier.js';
import { QueryGenerator } from './QueryGenerator.js';
import { BlogGenerator } from './BlogGenerator.js';

/**
 * LLMService - Facade that maintains backward compatibility
 * Delegates to LLMClient, TermClassifier, QueryGenerator, and BlogGenerator
 */
class LLMService extends LLMClient {
  constructor(options = {}) {
    super(options);
    this._termClassifier = new TermClassifier(this);
    this._queryGenerator = new QueryGenerator(this);
    this._blogGenerator = new BlogGenerator(this);
  }

  async classifyTerms(terms, articles) {
    return this._termClassifier.classifyTerms(terms, articles);
  }

  async generateSearchQueries(groupedTerms, articles, options) {
    return this._queryGenerator.generateSearchQueries(groupedTerms, articles, options);
  }

  async generateBlogArticle(primaryArticles, supportingArticles, topic, options) {
    return this._blogGenerator.generateBlogArticle(primaryArticles, supportingArticles, topic, options);
  }

  inferTopicFromArticles(articles) {
    return this._blogGenerator.inferTopicFromArticles(articles);
  }

  async optimizeQuery(query, missingPmids, articles) {
    return this._queryGenerator.optimizeQuery(query, missingPmids, articles);
  }
}

export default LLMService;
