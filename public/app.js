const state = {
  config: null,
  provider: "deepseek",
  messages: [],
  busy: false,
  currentController: null,
  currentPending: null,
  stopRequested: false,
};

const elements = {};

document.addEventListener("DOMContentLoaded", () => {
  elements.providerList = document.querySelector("#provider-list");
  elements.modelStatus = document.querySelector("#model-status");
  elements.chatProviderSwitcher = document.querySelector("#chat-provider-switcher");
  elements.qrCode = document.querySelector("#qr-code");
  elements.mobileUrl = document.querySelector("#mobile-url");
  elements.copyUrl = document.querySelector("#copy-url");
  elements.documentList = document.querySelector("#document-list");
  elements.chunkCount = document.querySelector("#chunk-count");
  elements.chatLog = document.querySelector("#chat-log");
  elements.chatForm = document.querySelector("#chat-form");
  elements.input = document.querySelector("#message-input");
  elements.sendButton = document.querySelector("#send-button");
  elements.sendButtonLabel = document.querySelector("#send-button span");
  elements.clearChat = document.querySelector("#clear-chat");

  bindEvents();
  loadConfig();
});

function bindEvents() {
  elements.chatForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state.busy) {
      stopGeneration();
      return;
    }
    await sendMessage(elements.input.value);
  });

  elements.clearChat.addEventListener("click", () => {
    state.messages = [];
    elements.chatLog.innerHTML = "";
    addWelcomeMessage();
  });

  elements.copyUrl.addEventListener("click", async () => {
    const value = state.config?.mobileUrl;
    if (!value) return;
    await navigator.clipboard.writeText(value);
    elements.copyUrl.classList.add("copied");
    setTimeout(() => elements.copyUrl.classList.remove("copied"), 900);
  });

  document.querySelectorAll("[data-prompt]").forEach((button) => {
    button.addEventListener("click", () => {
      elements.input.value = button.dataset.prompt;
      elements.input.focus();
    });
  });
}

async function loadConfig() {
  try {
    const response = await fetch("/api/config");
    state.config = await response.json();
    renderConfig();
    addWelcomeMessage();
  } catch (error) {
    addMessage("assistant", `配置读取失败：${error.message}`, { error: true });
  } finally {
    if (window.lucide) {
      window.lucide.createIcons();
    }
  }
}

function renderConfig() {
  const providers = state.config.providers || [];
  const savedProvider = localStorage.getItem("cyberSyndromeProvider");
  const savedConfigured = providers.find((provider) => provider.id === savedProvider && provider.configured);
  const currentConfigured = providers.find((provider) => provider.id === state.provider && provider.configured);
  const firstConfigured = providers.find((provider) => provider.configured);
  state.provider =
    savedConfigured?.id || currentConfigured?.id || firstConfigured?.id || providers[0]?.id || state.provider;

  renderProviderControls(providers);

  elements.qrCode.src = state.config.qrDataUrl;
  elements.mobileUrl.textContent = state.config.mobileUrl;
  elements.chunkCount.textContent = `${state.config.chunkCount || 0} 片段`;

  elements.documentList.innerHTML = (state.config.documents || [])
    .map(
      (doc) => `
        <div class="document-item">
          <strong>${escapeHtml(doc.title)}</strong>
          <span>${doc.pageCount} 页 · ${doc.chunkCount} 片段</span>
        </div>
      `,
    )
    .join("");

  renderProviderState();
}

function renderProviderControls(providers) {
  elements.providerList.innerHTML = providers
    .map((provider) => providerButtonMarkup(provider, "side"))
    .join("");

  elements.chatProviderSwitcher.innerHTML = providers
    .map((provider) => providerButtonMarkup(provider, "chat"))
    .join("");

  document.querySelectorAll("[data-provider]").forEach((button) => {
    button.addEventListener("click", () => {
      state.provider = button.dataset.provider;
      localStorage.setItem("cyberSyndromeProvider", state.provider);
      renderProviderState();
    });
  });
}

function providerButtonMarkup(provider, place) {
  const active = provider.id === state.provider;
  const configuredText = provider.configured ? "已配置" : `缺少 ${provider.missingKey}`;
  const className = place === "chat" ? "model-switch-button" : "provider-option";

  return `
    <button
      type="button"
      class="${className} ${active ? "active" : ""}"
      data-provider="${provider.id}"
      role="tab"
      aria-selected="${active}"
      title="切换到 ${escapeHtml(provider.label)}"
    >
      <strong>${escapeHtml(provider.label)}</strong>
      <span>${escapeHtml(provider.model)} · ${configuredText}</span>
    </button>
  `;
}

function renderProviderState() {
  const providers = state.config?.providers || [];
  const provider = providers.find((item) => item.id === state.provider);

  document.querySelectorAll("[data-provider]").forEach((button) => {
    const active = button.dataset.provider === state.provider;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });

  if (!provider) return;
  elements.modelStatus.textContent = provider.configured ? "可用" : "待配置";
  elements.modelStatus.className = `status-chip ${provider.configured ? "ready" : "warn"}`;
}

function addWelcomeMessage() {
  addMessage(
    "assistant",
    "你好，我会结合网络综合征资料回答。你可以直接描述困扰、想了解的概念，或让模型从 CPST 维度做分析。",
  );
}

async function sendMessage(rawText) {
  const text = rawText.trim();
  if (!text || state.busy) return;

  state.busy = true;
  state.stopRequested = false;
  state.currentController = new AbortController();
  elements.input.value = "";
  setBusyState(true);

  addMessage("user", text);
  state.messages.push({ role: "user", content: text });
  const pending = addMessage("assistant", "模型思考中", { loading: true });
  state.currentPending = pending;

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: state.currentController.signal,
      body: JSON.stringify({
        provider: state.provider,
        messages: state.messages,
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "请求失败。");
    }

    updateMessage(pending, payload.answer, {
      meta: `${providerLabel(payload.provider)} · ${payload.model || ""}`,
      sources: payload.sources || [],
    });
    state.messages.push({ role: "assistant", content: payload.answer });
  } catch (error) {
    const stopped = state.stopRequested || error.name === "AbortError";
    updateMessage(pending, stopped ? "已停止生成。" : error.message, { error: !stopped });
  } finally {
    state.busy = false;
    state.currentController = null;
    state.currentPending = null;
    state.stopRequested = false;
    setBusyState(false);
    elements.input.focus();
  }
}

function stopGeneration() {
  if (!state.busy || !state.currentController) {
    return;
  }

  state.stopRequested = true;
  state.currentController.abort();
  if (state.currentPending) {
    updateMessage(state.currentPending, "正在停止生成...");
  }
}

function setBusyState(isBusy) {
  elements.sendButton.disabled = false;
  elements.sendButton.classList.toggle("stop-mode", isBusy);
  elements.sendButton.setAttribute("aria-label", isBusy ? "停止生成" : "发送");
  elements.sendButtonLabel.textContent = isBusy ? "停止" : "发送";
}

function addMessage(role, text, options = {}) {
  const article = document.createElement("article");
  article.className = `message ${role} ${options.error ? "error" : ""}`;

  const bubble = document.createElement("div");
  bubble.className = `bubble ${options.loading ? "loading-dots" : ""}`;
  renderBubbleContent(bubble, text, {
    markdown: role === "assistant" && !options.error && !options.loading,
  });
  article.appendChild(bubble);

  if (options.meta) {
    const meta = document.createElement("div");
    meta.className = "message-meta";
    meta.textContent = options.meta;
    article.appendChild(meta);
  }

  elements.chatLog.appendChild(article);
  scrollChat();
  return article;
}

function updateMessage(article, text, options = {}) {
  const bubble = article.querySelector(".bubble");
  bubble.classList.remove("loading-dots");
  renderBubbleContent(bubble, text, {
    markdown: !options.error,
  });
  article.classList.toggle("error", Boolean(options.error));

  article.querySelectorAll(".message-meta, .sources").forEach((node) => node.remove());

  if (options.meta) {
    const meta = document.createElement("div");
    meta.className = "message-meta";
    meta.textContent = options.meta;
    article.appendChild(meta);
  }

  if (options.sources?.length) {
    const sourceWrap = document.createElement("div");
    sourceWrap.className = "sources";
    sourceWrap.innerHTML = options.sources
      .map(
        (source) => `
          <div class="source-item">
            <strong>${escapeHtml(source.sourceTitle)}</strong>
            <span>${escapeHtml(source.fileName)} · ${source.pageStart}-${source.pageEnd} 页</span>
            <div>${escapeHtml(source.excerpt)}...</div>
          </div>
        `,
      )
      .join("");
    article.appendChild(sourceWrap);
  }

  scrollChat();
}

function renderBubbleContent(bubble, text, options = {}) {
  if (!options.markdown) {
    bubble.classList.remove("rendered");
    bubble.textContent = text;
    return;
  }

  bubble.classList.add("rendered");
  bubble.innerHTML = markdownToHtml(text);
}

function markdownToHtml(markdown) {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let listType = null;

  const closeList = () => {
    if (listType) {
      html.push(`</${listType}>`);
      listType = null;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      closeList();
      continue;
    }

    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (heading) {
      closeList();
      html.push(`<p class="md-heading">${inlineMarkdown(heading[1])}</p>`);
      continue;
    }

    const unordered = line.match(/^[-*]\s+(.+)$/);
    if (unordered) {
      if (listType !== "ul") {
        closeList();
        listType = "ul";
        html.push("<ul>");
      }
      html.push(`<li>${inlineMarkdown(unordered[1])}</li>`);
      continue;
    }

    const ordered = line.match(/^\d+[.)]\s+(.+)$/);
    if (ordered) {
      if (listType !== "ol") {
        closeList();
        listType = "ol";
        html.push("<ol>");
      }
      html.push(`<li>${inlineMarkdown(ordered[1])}</li>`);
      continue;
    }

    closeList();
    html.push(`<p>${inlineMarkdown(line)}</p>`);
  }

  closeList();
  return html.join("");
}

function inlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/__(.+?)__/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

function providerLabel(id) {
  return state.config?.providers?.find((provider) => provider.id === id)?.label || id;
}

function scrollChat() {
  elements.chatLog.scrollTop = elements.chatLog.scrollHeight;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
