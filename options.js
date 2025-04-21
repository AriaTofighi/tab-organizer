document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('apiKey');
  const status = document.getElementById('status');
  
  // Load saved API key
  chrome.storage.sync.get(['geminiApiKey'], res => {
    if (res.geminiApiKey) {
      input.value = res.geminiApiKey;
    }
  });
  
  // Save API key
  document.getElementById('save').addEventListener('click', () => {
    const key = input.value.trim();
    
    if (!key) {
      status.textContent = 'Enter valid key';
      status.classList.remove('success');
      status.classList.add('error');
      return;
    }
    
    chrome.storage.sync.set({ geminiApiKey: key }, () => {
      status.textContent = '✓ Saved';
      status.classList.remove('error');
      status.classList.add('success');
      
      setTimeout(() => {
        status.textContent = '';
        status.classList.remove('success');
      }, 3000);
    });
  });
});