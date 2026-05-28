// Content script: captures selected text and sends it to the popup/background

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getSelection") {
    const selection = window.getSelection();
    const text = selection ? selection.toString().trim() : "";
    const title = document.title || "";
    const url = window.location.href;

    // Detect platform
    let platform = "";
    const hostname = window.location.hostname;
    if (hostname.includes("chatgpt.com") || hostname.includes("openai.com")) {
      platform = "ChatGPT";
    } else if (hostname.includes("claude.ai")) {
      platform = "Claude";
    } else if (hostname.includes("deepseek.com")) {
      platform = "DeepSeek";
    }

    sendResponse({ text, title, url, platform });
  }
  return true; // keep channel open for async response
});
