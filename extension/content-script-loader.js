void import(chrome.runtime.getURL('dist/extension/content-script.js')).catch((error) => {
  console.error('[chatgpt-web-driver] failed to load content script module', error);
});
