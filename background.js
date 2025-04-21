chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'organizeTabs') organizeTabs(msg.regroupAll);
});

// Listen for keyboard shortcuts
chrome.commands.onCommand.addListener((command) => {
  if (command === 'organize-tabs') {
    // Get the saved preference for regroupAll
    chrome.storage.sync.get(['organizeOption'], res => {
      const regroupAll = res.organizeOption === 'all';
      organizeTabs(regroupAll);
    });
  }
});

async function organizeTabs(regroupAll = false) {
  // 1. Load API key
  const key = await new Promise(res => chrome.storage.sync.get('geminiApiKey', res))
                      .then(res => res.geminiApiKey);
  if (!key) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/layer.png',
      title: 'Tab Organizer',
      message: 'Please enter your Gemini API key in the extension popup.'
    });
    return;
  }

  // 2. Query current-window tabs
  const tabs = await chrome.tabs.query({ currentWindow: true });
  
  // Get existing tab groups if we're not regrouping all tabs
  let existingGroups = [];
  if (!regroupAll) {
    try {
      // Get all tab groups in the current window
      const tabGroups = await chrome.tabGroups.query({ windowId: chrome.windows.WINDOW_ID_CURRENT });
      
      // For each group, get the tabs it contains
      for (const group of tabGroups) {
        const groupTabs = tabs.filter(tab => tab.groupId === group.id);
        existingGroups.push({
          id: group.id,
          title: group.title,
          color: group.color,
          tabIds: groupTabs.map(tab => tab.id)
        });
      }
    } catch (e) {
      console.error("Error getting existing groups:", e);
    }
  }
  
  // Get ungrouped tabs only if not regrouping all
  const tabsToOrganize = regroupAll ? tabs : tabs.filter(t => t.groupId === chrome.tabs.TAB_ID_NONE);
  
  // If there are no tabs to organize, show a notification and exit
  if (tabsToOrganize.length === 0) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/layer.png',
      title: 'Tab Organizer',
      message: 'No tabs to organize.'
    });
    return;
  }
  
  // Map tabs for the API
  const tabsData = tabsToOrganize.map(t => ({ id: t.id, title: t.title, url: t.url }));

  // Build different prompts based on whether we have existing groups
  let prompt;
  if (!regroupAll && existingGroups.length > 0) {
    // Create a prompt that includes existing groups
    prompt = `
You are an assistant that organizes Chrome tabs. I have two sets of information:

1. These are my EXISTING tab groups:
${JSON.stringify(existingGroups, null, 2)}

2. These are UNGROUPED tabs that need to be organized:
${JSON.stringify(tabsData, null, 2)}

Please analyze the ungrouped tabs and do one of the following for each tab:
1. Assign it to an existing group if it fits thematically
2. Create a new group for tabs that don't fit in any existing group

Return a JSON array with these possible object types:
1. For adding tabs to existing groups: {"action":"add_to_existing", "groupId": number, "tabIds": [numbers]}
2. For creating new groups: {"action":"create_new", "group": string, "tabIds": [numbers]}

Very important: Return ONLY the JSON array with no additional text, explanation, or markdown formatting.
`;
  } else {
    // Standard prompt for creating all new groups
    prompt = `
You are an assistant that organizes Chrome tabs. Given this JSON array of tabs:
${JSON.stringify(tabsData, null, 2)}
Return a JSON array of objects with fields "group" (string) and "tabIds" (array of numbers). Example:
[{"group":"Work","tabIds":[1,2,3]}]

Very important: Return ONLY the JSON array with no additional text, explanation, or markdown formatting.
`;
  }

  try {
    // Call Gemini 2.0 Flash via REST API
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
        })
      }
    );
    
    if (!resp.ok) throw new Error(resp.statusText);
    
    const json = await resp.json();
    console.log("API Response:", json);
    
    // Extract text from the response
    const textResponse = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!textResponse) throw new Error("Invalid or empty response from Gemini API");
    
    console.log("Raw text response:", textResponse);
    
    // Try to extract JSON if it's wrapped in code blocks
    let cleanedText = textResponse;
    const jsonMatch = textResponse.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch && jsonMatch[1]) {
      cleanedText = jsonMatch[1].trim();
    }
    
    console.log("Cleaned text for parsing:", cleanedText);
    
    // Parse the JSON response
    const aiResponse = JSON.parse(cleanedText);
    
    if (!Array.isArray(aiResponse)) {
      throw new Error("Expected JSON array response but received: " + typeof aiResponse);
    }

    // If regrouping all tabs, ungroup all existing grouped tabs first
    if (regroupAll) {
      const groupedTabs = tabs.filter(tab => tab.groupId !== chrome.tabs.TAB_ID_NONE);
      const groupedTabIds = groupedTabs.map(tab => tab.id);
      
      if (groupedTabIds.length > 0) {
        await chrome.tabs.ungroup(groupedTabIds);
      }
      
      // Process groups (all new in this case)
      await processNewGroups(aiResponse);
    } else if (existingGroups.length > 0) {
      // Handle mixed response (add to existing + create new)
      await processMixedResponse(aiResponse, existingGroups);
    } else {
      // Process new groups only
      await processNewGroups(aiResponse);
    }

    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/layer.png',
      title: 'Tab Organizer',
      message: 'Tabs organized successfully!'
    });
  } catch (e) {
    console.error("Error in organizeTabs:", e);
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/layer.png',
      title: 'Error',
      message: e.message
    });
  }
}

// Process response that might add to existing groups or create new ones
async function processMixedResponse(aiResponse, existingGroups) {
  const availableColors = ["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"];
  let colorIndex = 0;
  
  for (const item of aiResponse) {
    try {
      if (item.action === "add_to_existing") {
        // Add tabs to an existing group
        const { groupId, tabIds } = item;
        
        // Verify this group exists
        const groupExists = existingGroups.some(g => g.id === groupId);
        if (!groupExists) {
          console.warn(`Group ID ${groupId} does not exist, skipping`);
          continue;
        }
        
        // Get current tabs to verify tab IDs
        const currentTabs = await chrome.tabs.query({ currentWindow: true });
        const validTabIds = tabIds.filter(id => 
          currentTabs.some(tab => tab.id === id && tab.groupId === chrome.tabs.TAB_ID_NONE)
        );
        
        if (validTabIds.length > 0) {
          await chrome.tabs.group({ groupId, tabIds: validTabIds });
        } else {
          console.warn(`No valid ungrouped tabs found for existing group ${groupId}`);
        }
      } else if (item.action === "create_new" || item.group) {
        // Extract name and tabIds based on the format returned
        let name, tabIds;
        
        if (item.action === "create_new") {
          name = item.group;
          tabIds = item.tabIds;
        } else {
          name = item.group;
          tabIds = item.tabIds;
        }
        
        if (!name || !Array.isArray(tabIds) || tabIds.length === 0) {
          console.warn("Skipping invalid group data:", item);
          continue;
        }
        
        // Get current tabs again to verify tab IDs
        const currentTabs = await chrome.tabs.query({ currentWindow: true });
        const validTabIds = tabIds.filter(id => 
          currentTabs.some(tab => tab.id === id && tab.groupId === chrome.tabs.TAB_ID_NONE)
        );
        
        if (validTabIds.length > 0) {
          const newGroupId = await chrome.tabs.group({ tabIds: validTabIds });
          await chrome.tabGroups.update(newGroupId, {
            title: name,
            color: availableColors[colorIndex % availableColors.length]
          });
          colorIndex++;
        } else {
          console.warn(`No valid ungrouped tabs found for new group '${name}'`);
        }
      } else {
        console.warn("Unknown action or format in response item:", item);
      }
    } catch (groupError) {
      console.error(`Error processing group operation:`, groupError, item);
    }
  }
}

// Process simple new groups response
async function processNewGroups(groups) {
  const availableColors = ["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"];
  let colorIndex = 0;

  for (const grp of groups) {
    // Use standardized field names
    const name = grp.group;
    const ids = grp.tabIds;

    // Basic validation
    if (!name || !Array.isArray(ids) || ids.length === 0) {
      console.warn("Skipping invalid group data:", grp);
      continue;
    }

    try {
      // Get the current tabs again in case they changed
      const currentTabs = await chrome.tabs.query({ currentWindow: true });
      
      // Include all tabs that exist in the current window
      const validTabIds = ids.filter(id => currentTabs.some(tab => tab.id === id));

      if (validTabIds.length > 0) {
         const newGroupId = await chrome.tabs.group({ tabIds: validTabIds });
         await chrome.tabGroups.update(newGroupId, {
           title: name,
           color: availableColors[colorIndex % availableColors.length]
         });
         colorIndex++;
      } else {
        console.warn(`No valid tabs found for group '${name}' with tab IDs:`, ids);
      }
    } catch (groupError) {
      console.error(`Error grouping tabs for group '${name}':`, groupError);
    }
  }
}