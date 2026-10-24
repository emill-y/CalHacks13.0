// ThisBut background service worker: context menu + opening the side panel with a source image.

importScripts("config.js");

chrome.runtime.onInstalled.addListener((details) => {
  chrome.contextMenus.create({ id: "thisbut-image", title: "This, but…", contexts: ["image"] });
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  if (details.reason === "install") {
    // Short welcome/how-to page on the ThisBut server.
    chrome.tabs.create({ url: `${self.THISBUT_CONFIG.serverUrl.replace(/\/+$/, "")}/extension?installed=1` });
  }
});

function setSource(tabId, source) {
  return chrome.storage.session.set({ [`src:${tabId}`]: { ...source, ts: Date.now() } });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "thisbut-image" || !tab?.id) return;
  // open() must run synchronously inside the user gesture
  chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
  setSource(tab.id, { imageUrl: info.srcUrl, pageUrl: info.pageUrl || tab.url, title: tab.title || "" });
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type === "thisbut:source" && sender.tab?.id) {
    chrome.sidePanel.open({ tabId: sender.tab.id }).catch(() => {});
    setSource(sender.tab.id, { imageUrl: msg.imageUrl, pageUrl: msg.pageUrl, title: msg.title || "" });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => chrome.storage.session.remove(`src:${tabId}`));
