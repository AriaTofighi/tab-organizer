document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('apiKey');
  chrome.storage.sync.get(['geminiApiKey'], res => {
    if (res.geminiApiKey) input.value = res.geminiApiKey;
  });
  document.getElementById('save').addEventListener('click', () => {
    const key = input.value.trim();
    chrome.storage.sync.set({ geminiApiKey: key }, () => {
      const status = document.getElementById('status');
      status.textContent = 'Saved!';
      setTimeout(() => status.textContent = '', 2000);
    });
  });
});