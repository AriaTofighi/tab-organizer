document.getElementById('organize').addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'organizeTabs' });
});