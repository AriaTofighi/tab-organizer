document.addEventListener('DOMContentLoaded', () => {
  const apiKeyInput = document.getElementById('apiKey');
  const apiStatus = document.getElementById('apiStatus');
  const newTabsOnlyRadio = document.getElementById('newTabsOnly');
  const allTabsRadio = document.getElementById('allTabs');
  
  // Load saved settings
  chrome.storage.sync.get(['geminiApiKey', 'organizeOption', 'shortcutKey'], res => {
    // Load API key
    if (res.geminiApiKey) {
      apiKeyInput.value = res.geminiApiKey;
      apiStatus.textContent = '✓ Saved';
      apiStatus.classList.add('success');
    }
    
    // Load organization option
    if (res.organizeOption === 'all') {
      allTabsRadio.checked = true;
    } else {
      newTabsOnlyRadio.checked = true;
    }
  });
  
  // Save API key
  document.getElementById('saveKey').addEventListener('click', () => {
    const key = apiKeyInput.value.trim();
    
    if (!key) {
      apiStatus.textContent = 'Enter valid key';
      apiStatus.classList.remove('success');
      apiStatus.classList.add('error');
      return;
    }
    
    chrome.storage.sync.set({ geminiApiKey: key }, () => {
      apiStatus.textContent = '✓ Saved';
      apiStatus.classList.remove('error');
      apiStatus.classList.add('success');
      
      setTimeout(() => {
        apiStatus.textContent = '';
        apiStatus.classList.remove('success');
      }, 3000);
    });
  });
  
  // Save option when changed
  const saveOrganizeOption = () => {
    const regroupAll = allTabsRadio.checked;
    chrome.storage.sync.set({ organizeOption: regroupAll ? 'all' : 'new' });
  };
  
  newTabsOnlyRadio.addEventListener('change', saveOrganizeOption);
  allTabsRadio.addEventListener('change', saveOrganizeOption);
  
  // Organize tabs
  document.getElementById('organize').addEventListener('click', () => {
    const key = apiKeyInput.value.trim();
    
    if (!key) {
      apiStatus.textContent = 'API key required';
      apiStatus.classList.remove('success');
      apiStatus.classList.add('error');
      return;
    }
    
    // Get the selected organization option
    const regroupAll = allTabsRadio.checked;
    
    // Save the choice for next time
    saveOrganizeOption();
    
    chrome.runtime.sendMessage({ 
      action: 'organizeTabs',
      regroupAll: regroupAll
    });
    
    window.close();
  });
  
  // Keyboard shortcut configuration
  document.getElementById('configureShortcut').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({
      url: 'chrome://extensions/shortcuts'
    });
  });
});