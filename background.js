chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'organizeTabs') organizeTabs();
});

async function organizeTabs() {
  // 1. Load API key
  const key = await new Promise(res => chrome.storage.sync.get('geminiApiKey', res))
                      .then(res => res.geminiApiKey);
  if (!key) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/layer.png',
      title: 'Tab Organizer',
      message: 'Please set your Gemini API key in Options.'
    });
    return;
  }

  // 2. Query current-window tabs
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const tabsData = tabs.map(t => ({ id: t.id, title: t.title, url: t.url }));

  // 3. Build prompt
  const prompt = `
You are an assistant that organizes Chrome tabs. Given this JSON array of tabs:
${JSON.stringify(tabsData, null, 2)}
Return a JSON array of objects with fields "group" (string) and "tabIds" (array of numbers). Example:
[{"group":"Work","tabIds":[1,2,3]}]

Very important: Return ONLY the JSON array with no additional text, explanation, or markdown formatting.
`;

  try {
    // 4. Call Gemini 2.0 Flash via REST API
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
    const groups = JSON.parse(cleanedText);
    
    if (!Array.isArray(groups)) {
      throw new Error("Expected JSON array response but received: " + typeof groups);
    }

    // 5. Create & populate tab groups
    const availableColors = ["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"];
    let colorIndex = 0;

    for (const grp of groups) {
      // Use standardized field names (adjust prompt if needed)
      const name = grp.group;
      const ids = grp.tabIds;

      // Basic validation
      if (!name || !Array.isArray(ids) || ids.length === 0) {
        console.warn("Skipping invalid group data:", grp);
        continue;
      }

      try {
        // Filter tab IDs to only include tabs that exist in the current window and are not already grouped
        const currentTabs = await chrome.tabs.query({ currentWindow: true });
        const validTabIds = ids.filter(id => currentTabs.some(tab => tab.id === id && tab.groupId === chrome.tabs.TAB_ID_NONE));

        if (validTabIds.length > 0) {
           const newGroupId = await chrome.tabs.group({ tabIds: validTabIds });
           await chrome.tabGroups.update(newGroupId, {
             title: name,
             color: availableColors[colorIndex % availableColors.length]
           });
           colorIndex++;
        } else {
          console.warn(`No valid, ungrouped tabs found for group '${name}' with tab IDs:`, ids);
        }
      } catch (groupError) {
        console.error(`Error grouping tabs for group '${name}':`, groupError);
        // Optionally notify the user about specific group errors
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icons/layer.png',
          title: 'Grouping Error',
          message: `Could not create group '${name}'. Check console for details.`
        });
      }
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