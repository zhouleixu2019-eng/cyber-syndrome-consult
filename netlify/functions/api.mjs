import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const knowledgePath = findKnowledgePath();

const corpus = loadCorpus();
const preparedChunks = corpus.chunks.map((chunk, index) => ({
  ...chunk,
  index,
  searchText: normalizeSearchText(`${chunk.sourceTitle} ${chunk.fileName} ${chunk.text}`),
}));
const knowledgeBrief = buildKnowledgeBrief();

export async function handler(event) {
  try {
    if (event.httpMethod === "OPTIONS") {
      return jsonResponse(204, {});
    }

    const route = routeName(event.path);

    if (event.httpMethod === "GET" && route === "health") {
      return jsonResponse(200, {
        ok: true,
        documents: corpus.documents.length,
        chunks: corpus.chunks.length,
      });
    }

    if (event.httpMethod === "GET" && route === "config") {
      const siteUrl = publicUrl(event);
      const qrDataUrl = await QRCode.toDataURL(siteUrl, {
        margin: 1,
        scale: 7,
        color: {
          dark: "#17221f",
          light: "#ffffff",
        },
      });

      return jsonResponse(200, {
        providers: Object.values(providerConfigs()).map((provider) => ({
          id: provider.id,
          label: provider.label,
          model: provider.model,
          configured: Boolean(provider.apiKey),
          missingKey: provider.apiKey ? null : provider.apiKeyName,
        })),
        documents: corpus.documents.map(toPublicDocument),
        chunkCount: corpus.chunks.length,
        mobileUrl: siteUrl,
        qrDataUrl,
      });
    }

    if (event.httpMethod === "POST" && route === "chat") {
      const payload = event.body ? JSON.parse(event.body) : {};
      const result = await handleChat(payload);
      return jsonResponse(200, result);
    }

    return jsonResponse(404, { error: "未找到接口。" });
  } catch (error) {
    const status = error.statusCode || 500;
    return jsonResponse(status, {
      error: error.message || "服务端处理失败。",
    });
  }
}

async function handleChat(payload) {
  const providerId = String(payload.provider || "deepseek");
  const provider = providerConfigs()[providerId];
  if (!provider) {
    throw httpError(400, "未知模型供应商。");
  }

  if (!provider.apiKey) {
    throw httpError(400, `尚未配置 ${provider.apiKeyName}。请在 Netlify 环境变量中填写密钥后重新部署。`);
  }

  const messages = sanitizeMessages(payload.messages);
  const lastUserMessage = [...messages].reverse().find((message) => message.role === "user");
  if (!lastUserMessage?.content) {
    throw httpError(400, "请输入一个问题。");
  }

  const sources = retrieveContext(lastUserMessage.content, provider.id === "qwen" ? 2 : 3);
  const requestMessages = [
    { role: "system", content: buildSystemPrompt(sources) },
    ...messages.slice(provider.id === "qwen" ? -4 : -6),
  ];

  const body = {
    model: provider.model,
    messages: requestMessages,
    temperature: Number(process.env.MODEL_TEMPERATURE || (provider.id === "qwen" ? 0.25 : 0.35)),
    max_tokens: Number(
      process.env[`${provider.id.toUpperCase()}_MAX_TOKENS`] ||
        process.env.MODEL_MAX_TOKENS ||
        (provider.id === "qwen" ? 450 : 750),
    ),
  };

  if (provider.id === "deepseek") {
    body.thinking = {
      type: process.env.DEEPSEEK_THINKING === "enabled" ? "enabled" : "disabled",
    };
  }

  if (provider.id === "qwen") {
    body.enable_thinking = process.env.QWEN_ENABLE_THINKING === "true";
  }

  const completion = await callChatCompletion(provider, body);
  const answer = completion.choices?.[0]?.message?.content?.trim();
  if (!answer) {
    throw httpError(502, "模型没有返回可显示的回答。");
  }

  return {
    answer,
    model: completion.model || provider.model,
    provider: provider.id,
    sources: sources.slice(0, 2).map(toPublicSource),
    usage: completion.usage || null,
  };
}

function providerConfigs() {
  return {
    deepseek: {
      id: "deepseek",
      label: "DeepSeek",
      apiKey: process.env.DEEPSEEK_API_KEY,
      apiKeyName: "DEEPSEEK_API_KEY",
      baseUrl: trimSlash(process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com"),
      model: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
    },
    qwen: {
      id: "qwen",
      label: "通义千问",
      apiKey: process.env.QWEN_API_KEY || process.env.DASHSCOPE_API_KEY,
      apiKeyName: process.env.QWEN_API_KEY ? "QWEN_API_KEY" : "DASHSCOPE_API_KEY",
      baseUrl: trimSlash(
        process.env.QWEN_BASE_URL ||
          process.env.DASHSCOPE_BASE_URL ||
          "https://dashscope.aliyuncs.com/compatible-mode/v1",
      ),
      model: process.env.QWEN_MODEL || "qwen3.7-plus",
    },
  };
}

function findKnowledgePath() {
  const candidates = [
    path.join(process.cwd(), "data", "cyber_syndrome_knowledge.json"),
    path.join(__dirname, "..", "..", "data", "cyber_syndrome_knowledge.json"),
    path.join(__dirname, "..", "..", "..", "data", "cyber_syndrome_knowledge.json"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

function loadCorpus() {
  if (!fs.existsSync(knowledgePath)) {
    return {
      documents: [],
      chunks: [
        {
          id: "fallback:1",
          sourceTitle: "Cyber-Syndrome Consultation",
          fileName: "fallback",
          pageStart: 1,
          pageEnd: 1,
          text: "Cyber-Syndrome consultation should combine cyber, physical, social, and thinking dimensions, and should not replace professional medical or psychological diagnosis.",
        },
      ],
    };
  }

  return JSON.parse(fs.readFileSync(knowledgePath, "utf-8"));
}

function publicUrl(event) {
  if (process.env.PUBLIC_URL) {
    return process.env.PUBLIC_URL.replace(/\/+$/, "");
  }
  if (process.env.URL) {
    return process.env.URL.replace(/\/+$/, "");
  }

  const host = event.headers["x-forwarded-host"] || event.headers.host;
  const proto = event.headers["x-forwarded-proto"] || "https";
  return host ? `${proto}://${host}` : "";
}

function routeName(eventPath = "") {
  const clean = eventPath.replace(/\/+$/, "");
  if (clean.endsWith("/health")) return "health";
  if (clean.endsWith("/config")) return "config";
  if (clean.endsWith("/chat")) return "chat";
  return clean.split("/").pop() || "";
}

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
    body: statusCode === 204 ? "" : JSON.stringify(body),
  };
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function trimSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function sanitizeMessages(messages) {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages
    .filter((message) => ["user", "assistant"].includes(message.role))
    .map((message) => ({
      role: message.role,
      content: String(message.content || "").slice(0, 3000),
    }))
    .filter((message) => message.content.trim());
}

function buildSystemPrompt(sources) {
  const context = sources
    .map(
      (source, index) =>
        `[${index + 1}] ${source.sourceTitle} | ${source.fileName} | pages ${source.pageStart}-${source.pageEnd}\n${truncateText(source.text, 700)}`,
    )
    .join("\n\n");

  return `你是“网络综合征咨询助手”，面向中文用户提供学习、科普、风险梳理和恢复建议。

回答原则：
1. 先给结论，再给必要解释；默认控制在 150-350 字。
2. 不要逐篇遍历资料，不要堆砌参考文献；只吸收下方“资料凝练”和最相关片段。
3. 如果用户没有要求展开，最多列 3-4 点，每点一句到两句。
4. 不要输出 Markdown 标题符号（如 #、####）或星号强调符号（如 **）；可以用短段落或“1. 2. 3.”。
5. 围绕 CPST（Cyber-Physical-Social-Thinking）空间分析网络综合征相关问题。
6. 不进行医学诊断，不替代医生、心理咨询师或其他专业人员；涉及自伤风险、严重躯体症状、急性精神心理危机时，建议立即联系当地急救、医院或可信赖的专业支持。
7. 资料不足时直接说明，不要编造论文结论、统计数据或出处。

资料凝练：
${knowledgeBrief}

相关片段（只用于核对细节，不要全部复述）：
${context || "当前资料库为空，只能给出一般性咨询建议。"}`;
}

function buildKnowledgeBrief() {
  return [
    "网络综合征可从 CPST 空间理解：网络行为会同时影响网络使用、身体状态、社会关系和思维情绪。",
    "常见关注点包括过度上网、游戏或社交媒体依赖，睡眠和视疲劳，现实社交减少，焦虑、注意力和自我调节困难。",
    "咨询回答应优先帮助用户识别风险、梳理触发因素、制定温和可执行的调整方案，而不是直接下诊断。",
    "恢复和预防通常需要多维度组合：限制高风险场景、改善作息和身体活动、增加现实支持、建立替代行为，并在严重情况寻求专业帮助。",
  ].join("\n");
}

function normalizeSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\u4e00-\u9fa5]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function expandQuery(query) {
  const normalizedQuery = query.replaceAll("网络综合\u75c7", "网络综合征");
  const glossary = [
    ["网络综合征", "cyber syndrome cyber-syndrome internet addiction problematic internet use"],
    ["成因", "formation cause mechanism etiology"],
    ["分类", "classification type taxonomy"],
    ["恢复", "recovery intervention rehabilitation adjustment"],
    ["预防", "prevention prevent protective"],
    ["症状", "symptom symptoms manifestation sign"],
    ["穴位", "acupoint acupoints acupuncture"],
    ["热疗", "hyperthermia thermal therapy"],
    ["机器人", "robot robots robotic"],
    ["控制", "control mechanism regulation"],
    ["概念", "concept definition characterization"],
    ["理论", "theory theoretical characterization"],
    ["需求", "need needs maslow hierarchy"],
    ["马斯洛", "maslow hierarchy needs"],
    ["身体", "physical health body physiological"],
    ["心理", "thinking cognition emotion mental"],
    ["社会", "social relationship support"],
    ["网络", "cyber internet online"],
    ["睡眠", "sleep circadian insomnia"],
    ["焦虑", "anxiety stress emotion"],
    ["抑郁", "depression mood"],
  ];

  let expanded = normalizedQuery;
  for (const [needle, addition] of glossary) {
    if (normalizedQuery.includes(needle)) {
      expanded += ` ${addition}`;
    }
  }
  return expanded;
}

function queryTerms(query) {
  const expanded = normalizeSearchText(expandQuery(query));
  const latinTerms = expanded.match(/[a-z0-9][a-z0-9-]{2,}/g) || [];
  const chineseTerms = [];
  const chinesePhrases = expanded.match(/[\u4e00-\u9fa5]{2,}/g) || [];
  for (const phrase of chinesePhrases) {
    chineseTerms.push(phrase);
    for (let index = 0; index < phrase.length - 1; index += 1) {
      chineseTerms.push(phrase.slice(index, index + 2));
    }
  }

  const stopWords = new Set([
    "the",
    "and",
    "for",
    "with",
    "from",
    "that",
    "this",
    "what",
    "how",
    "are",
    "was",
    "were",
    "about",
    "into",
    "需要",
    "什么",
    "如何",
    "怎么",
    "一下",
  ]);

  return [...new Set([...latinTerms, ...chineseTerms])].filter(
    (term) => term.length >= 2 && !stopWords.has(term),
  );
}

function retrieveContext(query, limit = 4) {
  const terms = queryTerms(query);
  const scored = preparedChunks.map((chunk) => {
    let score = 0;
    for (const term of terms) {
      const count = occurrenceCount(chunk.searchText, term);
      if (count) {
        score += count * (term.length > 4 ? 2.5 : 1);
      }
    }
    if (chunk.pageStart <= 2) {
      score += 0.15;
    }
    return { chunk, score };
  });

  const ranked = scored
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  const matches = diversifyChunks(ranked, limit);

  if (matches.length >= Math.min(2, limit)) {
    return matches;
  }

  const fallback = preparedChunks
    .filter((chunk) => chunk.pageStart <= 2)
    .slice(0, limit - matches.length);

  return [...matches, ...fallback].slice(0, limit);
}

function diversifyChunks(scoredItems, limit) {
  const selected = [];
  const usedSources = new Set();

  for (const item of scoredItems) {
    const sourceKey = item.chunk.sourceKey || item.chunk.sourceTitle || item.chunk.fileName;
    if (usedSources.has(sourceKey)) {
      continue;
    }
    selected.push(item.chunk);
    usedSources.add(sourceKey);
    if (selected.length >= limit) {
      return selected;
    }
  }

  for (const item of scoredItems) {
    if (!selected.includes(item.chunk)) {
      selected.push(item.chunk);
    }
    if (selected.length >= limit) {
      break;
    }
  }

  return selected;
}

function occurrenceCount(text, term) {
  if (!term) {
    return 0;
  }
  let count = 0;
  let position = text.indexOf(term);
  while (position !== -1) {
    count += 1;
    position = text.indexOf(term, position + term.length);
  }
  return count;
}

async function callChatCompletion(provider, body) {
  const endpoint = `${provider.baseUrl}/chat/completions`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }

  if (!response.ok) {
    const detail =
      payload?.error?.message ||
      payload?.message ||
      payload?.raw ||
      `${response.status} ${response.statusText}`;
    throw httpError(502, `${provider.label} 请求失败：${detail}`);
  }

  return payload;
}

function toPublicDocument(document) {
  return {
    key: document.key,
    title: document.title,
    fileName: document.fileName,
    pageCount: document.pageCount,
    chunkCount: document.chunkCount,
  };
}

function toPublicSource(source) {
  const excerpt = source.text.replace(/\s+/g, " ").slice(0, 150);
  return {
    id: source.id,
    sourceTitle: source.sourceTitle,
    fileName: source.fileName,
    pageStart: source.pageStart,
    pageEnd: source.pageEnd,
    excerpt,
  };
}

function truncateText(value, maxLength) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}
