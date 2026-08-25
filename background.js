// background.js
chrome.runtime.onInstalled.addListener((details) => {
  console.log('Yahoo Fantasy Draft Round extension installed', details.reason);
});