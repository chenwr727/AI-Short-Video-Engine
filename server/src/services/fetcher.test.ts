import assert from "node:assert/strict";
import test from "node:test";
import { charsetFrom, dedupeParagraphs, detectAntiBot, extractArticle, isSubstantial } from "./fetcher.js";

const PARAGRAPHS = Array.from(
  { length: 10 },
  (_, i) => `<p>第 ${i + 1} 段正文，这里讲的是测试文章的内容，包含足够多的中文字符和完整句读，用来验证正文提取。</p>`,
).join("");

const PAGE = `<html><head><title>测试文章标题</title></head><body>
<nav><a href="/">首页</a><a href="/news">新闻</a><a href="/sports">体育</a></nav>
<article><p>上一篇：测试文章</p><h1>测试文章标题</h1>${PARAGRAPHS}<p>往年回顾</p><p>某某文章（2023）</p><p>（完）</p><p>版权声明：自由转载</p></article>
<aside class="recommend"><a href="/1">推荐一</a><a href="/2">推荐二</a></aside>
<div class="comment-list"><p>网友评论一，这段内容不应该出现在正文里。</p><p>网友评论二，这段内容也不应该出现。</p></div>
<footer>版权所有 测试站</footer>
</body></html>`;

test("从页面里挑出正文并丢掉导航、评论与页脚", () => {
  const article = extractArticle(PAGE);
  assert.equal(article.source, "dom");
  assert.ok(article.text.includes("第 1 段正文"));
  assert.ok(article.text.startsWith("测试文章标题"));
  assert.ok(!article.text.includes("推荐一"));
  assert.ok(!article.text.includes("网友评论"));
  assert.ok(!article.text.includes("版权所有"));
  assert.ok(!article.text.includes("版权声明"));
  assert.ok(article.text.endsWith("用来验证正文提取。"));
  assert.ok(article.linkDensity < 0.1);
});

test("正文太短时给反爬页判定，长文不受影响", () => {
  assert.ok(detectAntiBot("安全验证", "系统正在检测当前网络环境，请稍候。", ""));
  assert.equal(detectAntiBot("Cloudflare 是如何验证访客的", "这是一篇正常文章的正文。".repeat(200), ""), null);
  assert.ok(detectAntiBot("", "页面加载中", "<script src='/cf-browser-verification.js'></script>"));
});

test("段落去重会丢掉被长段落包含的碎片", () => {
  assert.deepEqual(dedupeParagraphs(["甲", "甲", "乙", "甲乙"]), ["甲乙"]);
  assert.deepEqual(dedupeParagraphs(["", " ", "短句"]), ["短句"]);
});

test("正文质量门槛", () => {
  assert.equal(isSubstantial("字".repeat(100)), false);
  assert.equal(isSubstantial("这是一段正常的正文内容，包含完整句读。".repeat(20)), true);
  assert.equal(isSubstantial("This is a normal sentence about the article. ".repeat(20)), true);
});

test("编码识别优先响应头，其次 meta", () => {
  assert.equal(charsetFrom("text/html; charset=GBK", ""), "gbk");
  assert.equal(charsetFrom(null, '<meta charset="gb2312">'), "gb2312");
  assert.equal(charsetFrom(null, "<html></html>"), "utf-8");
});
