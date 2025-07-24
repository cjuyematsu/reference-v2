// background.js

chrome.runtime.onInstalled.addListener(() => {
  // Create a context menu item that only appears on LinkedIn profile pages
  chrome.contextMenus.create({
    id: "saveLinkedInProfile",
    title: "Save LinkedIn Profile",
    contexts: ["page"],
    documentUrlPatterns: ["https://www.linkedin.com/in/*"]
  });
});

// Waits for a click on any context menu item from this extension
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "saveLinkedInProfile") {
    if (tab && tab.id) {
      chrome.tabs.sendMessage(tab.id, { action: "saveProfile" });
    }
  }
});