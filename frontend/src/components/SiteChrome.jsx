import React from "react";
import { FOLLOW_LINKS } from "./followLinks";

const MAKER_URL = "https://sportsmedicine.tw/";

/** 頁首：品牌與製作者（連到吳易澄醫師網站） */
export function SiteHeader() {
  return (
    <header className="app-header">
      <div className="shell app-header-inner">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5M8 11h6M11 8v6" />
            </svg>
          </span>
          <span>
            <h1 className="brand-title">Reverse-Engineer Searcher</h1>
            <span className="brand-subtitle">從種子文獻反推系統性回顧檢索式</span>
          </span>
        </div>
        <a className="maker" href={MAKER_URL} target="_blank" rel="noopener noreferrer" aria-label="製作者：運動醫學科 吳易澄醫師（在新分頁開啟）">
          <span className="maker-label">製作者</span>
          <span className="maker-name">運動醫學科 吳易澄醫師</span>
        </a>
      </div>
    </header>
  );
}

function FollowIcon({ link }) {
  return (
    <svg {...link.svg} width="22" height="22" aria-hidden="true">
      {link.children.map((child, i) => React.createElement(child.tag, { key: i, ...child.attrs }))}
    </svg>
  );
}

/** 頁尾：依 injury.sportsmedicine.tw 的三欄結構與追蹤連結 */
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="footer-top">
        <div className="shell footer-grid">
          <nav className="footer-column" aria-label="使用說明">
            <p className="footer-heading">使用說明</p>
            <ul>
              <li><a href="#how-it-works">如何使用</a></li>
              <li><a href="https://github.com/keanu77/reverse-engineer-searcher" target="_blank" rel="noopener noreferrer">原始碼（GitHub）</a></li>
              <li><a href="https://doi.org/10.1186/2046-4053-1-19" target="_blank" rel="noopener noreferrer">方法參考：Hausner et al. 2012</a></li>
            </ul>
          </nav>
          <nav className="footer-column" aria-label="關於本站">
            <p className="footer-heading">關於本站</p>
            <ul>
              <li><a href="https://sportsmedicine.tw/content/" target="_blank" rel="noopener noreferrer">返回吳易澄醫師網站</a></li>
              <li><a href="https://metacalc.sportsmedicine.tw/" target="_blank" rel="noopener noreferrer">Meta-Analysis Calculator</a></li>
              <li><a href="https://injury.sportsmedicine.tw/" target="_blank" rel="noopener noreferrer">運動傷害影片圖鑑</a></li>
            </ul>
          </nav>
          <nav className="footer-column" aria-label="追蹤吳易澄醫師">
            <p className="footer-heading">追蹤連結</p>
            <ul className="footer-follow-list">
              {FOLLOW_LINKS.map((link) => (
                <li key={link.href}>
                  <a href={link.href} target="_blank" rel="noopener noreferrer" aria-label={`${link.label}（在新分頁開啟）`} title={link.label}>
                    <FollowIcon link={link} />
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>
        <div className="shell footer-about">
          <p>輸入的 PMID 與產生的檢索式只用於本次請求；API Key 只保留在目前分頁的記憶體中。</p>
        </div>
      </div>
      <div className="footer-bottom">
        <div className="shell footer-bottom-inner">
          <p>
            &copy; 2026 Reverse-Engineer Searcher · 製作者：
            <a href={MAKER_URL} target="_blank" rel="noopener noreferrer">運動醫學科 吳易澄醫師</a>
          </p>
          <p>本工具產生的是候選檢索式與衛教草稿，正式系統性回顧仍需資訊專家審閱；科普內容不構成醫療建議。</p>
        </div>
      </div>
    </footer>
  );
}

const STEPS = [
  {
    image: "/images/seeds.webp",
    title: "1. 選種子文獻，另留驗證組",
    text: "貼上 3–10 篇確定應被找到的論文 PMID。再另外留幾篇不拿來建構，只用來檢查檢索式對沒看過的文獻是否也有效。",
  },
  {
    image: "/images/terms.webp",
    title: "2. 分析詞彙、產生檢索式",
    text: "統計種子文獻的 MeSH 與關鍵字，由 AI 依 PICO 分類，產生 Sensitive／Balanced／Compact 三種 PubMed 檢索式並逐條檢查語法。",
  },
  {
    image: "/images/databases.webp",
    title: "3. 驗證後轉成其他資料庫",
    text: "回 PubMed 確認每篇種子與驗證組是否被找到，再轉成 Embase、Cochrane、WoS、Scopus 語法草稿，無法等價轉換之處會提醒。",
  },
];

/** 空狀態：三步驟說明 */
export function HowItWorks() {
  return (
    <section className="how-it-works" id="how-it-works" aria-labelledby="how-heading">
      <h2 id="how-heading">如何使用</h2>
      <div className="step-grid">
        {STEPS.map((step) => (
          <article className="step-card" key={step.title}>
            <img src={step.image} alt="" width="360" height="300" loading="lazy" />
            <h3>{step.title}</h3>
            <p>{step.text}</p>
          </article>
        ))}
      </div>
      <p className="how-note">
        種子涵蓋率只代表這組種子文獻，不是對所有相關文獻的召回率。產生的檢索式是候選草稿，建議交由資訊專家審閱（例如 PRESS 同儕審查）後再使用。
      </p>
    </section>
  );
}
