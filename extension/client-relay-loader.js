const controlPort = Number(location.port);
const isControlPage = location.pathname === '/__extension-control.html'
  && Number.isInteger(controlPort)
  && controlPort >= 4318
  && controlPort <= 4327;

if (location.port === '4317' || isControlPage) {
  void import(chrome.runtime.getURL('dist/extension/client-relay.js')).catch((error) => {
    console.error('[chatgpt-web-driver] failed to load client relay module', error);
  });
}
