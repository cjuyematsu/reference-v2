// content.js

(function() {
  let floatingWidget = null;
  let currentProfileUrl = null;
  let currentProfileName = null;

  // Parses duration into date to check for people who worked at the same company at the same time
  function parseDuration(durationStr) {
    if (!durationStr) return { start: null, end: null };
    const cleanDurationStr = durationStr.split('·')[0].trim();
    const now = new Date();
    const monthMap = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
    
    const monthYearRegex = /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})/gi;
    const monthYearMatches = [...cleanDurationStr.matchAll(monthYearRegex)];
    if (monthYearMatches.length > 0) {
      const startMatch = monthYearMatches[0];
      const start = new Date(startMatch[2], monthMap[startMatch[1].toLowerCase()]);
      let end = null;
      if (cleanDurationStr.toLowerCase().includes('present')) {
        end = now;
      } else if (monthYearMatches.length > 1) {
        const endMatch = monthYearMatches[1];
        end = new Date(endMatch[2], monthMap[endMatch[1].toLowerCase()]);
      } else {
        end = new Date(start);
      }
      if (end) end.setMonth(end.getMonth() + 1, 0); 
      return { start, end };
    }

    const yearOnlyRegex = /(\d{4})/g;
    const yearMatches = [...cleanDurationStr.matchAll(yearOnlyRegex)];
    if (yearMatches.length > 0) {
      const start = new Date(yearMatches[0][1], 0);
      let end = null;
      if (cleanDurationStr.toLowerCase().includes('present')) {
        end = now;
      } else if (yearMatches.length > 1) {
        end = new Date(yearMatches[1][1], 11, 31);
      } else {
        end = new Date(yearMatches[0][1], 11, 31);
      }
      return { start, end };
    }
    return { start: null, end: null };
  }
  
  function normalizeCompanyName(name) {
    if (!name) return '';
    return name.toLowerCase().replace(/,?\s*(llc|inc|ltd|gmbh)\.?/g, '').trim();
  }

  // Finds overlapping work history
  async function findAndDisplayMatches() {
    const btn = document.getElementById('find-connections-btn');
    const resultsContainer = document.getElementById('cross-reference-results');
    if (!btn || !resultsContainer) return;

    btn.disabled = true;
    btn.textContent = 'Searching...';
    resultsContainer.style.display = 'block';
    resultsContainer.innerHTML = '<p style="color: #5e5e5e; font-size: 14px; text-align: center;">Searching...</p>';
    
    console.clear(); 
    const currentPageData = extractProfileData();

    const result = await chrome.storage.local.get(['profiles']);
    if (chrome.runtime.lastError) {
        console.error("Context invalidated.", chrome.runtime.lastError.message);
        btn.disabled = false; btn.textContent = 'Find Shared Connections';
        resultsContainer.innerHTML = '<p style="color: red;">An error occurred. Please try again.</p>';
        return;
    }
    const savedProfiles = Object.values(result.profiles || {});
    
    const currentPageExperiences = currentPageData.workExperience || [];

    if (savedProfiles.length === 0 || currentPageExperiences.length === 0) {
      console.error("DEBUG: Search stopped. Missing saved profiles or current page experience data.");
      resultsContainer.innerHTML = '<p style="color: #666;">Not enough data to run a search. Please save profiles and ensure the current page has work experience listed.</p>';
      btn.disabled = false; btn.textContent = 'Find Shared Connections';
      return;
    }

    const connections = [];
    for (const savedProfile of savedProfiles) {
      if (!savedProfile || !savedProfile.profileUrl || savedProfile.profileUrl === currentPageData.profileUrl) { continue; }

      console.groupCollapsed(`Comparing with saved profile: ${savedProfile.name}`);
      for (const savedExp of (savedProfile.workExperience || [])) {
        for (const currentExp of currentPageExperiences) {
          
          const normalizedSavedCompany = normalizeCompanyName(savedExp.company);
          const normalizedCurrentCompany = normalizeCompanyName(currentExp.company);

          if (normalizedSavedCompany && normalizedSavedCompany === normalizedCurrentCompany) {
            console.groupCollapsed(`Company Match: "${savedExp.company}"`);
            
            const currentDates = parseDuration(currentExp.duration);
            
            const savedDates = parseDuration(savedExp.duration);

            if (savedDates.start && savedDates.end && currentDates.start && currentDates.end) {
              if (savedDates.start <= currentDates.end && currentDates.start <= savedDates.end) {
                const overlapStart = new Date(Math.max(savedDates.start, currentDates.start));
                const overlapEnd = new Date(Math.min(savedDates.end, currentDates.end));
                connections.push({ 
                  name: savedProfile.name, 
                  profileUrl: savedProfile.profileUrl, 
                  company: savedExp.company, 
                  overlap: { start: overlapStart, end: overlapEnd },
                  savedTitle: savedExp.title,
                  currentTitle: currentExp.title
                });
              } 
            } 
            console.groupEnd();
          }
        }
      }
      console.groupEnd();
    }
    if (connections.length > 0) {
      let html = `<h4 style="margin-top: 20px; margin-bottom: 10px; color: #0a66c2;">Found Shared Work History!</h4><ul style="margin: 0; padding-left: 20px;">`;
      const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      
      // Group connections by person
      const groupedConnections = connections.reduce((acc, conn) => {
        const key = conn.profileUrl;
        if (!acc[key]) {
          acc[key] = {
            name: conn.name,
            profileUrl: conn.profileUrl,
            experiences: []
          };
        }
        acc[key].experiences.push(conn);
        return acc;
      }, {});
      
      const now = new Date();
      Object.values(groupedConnections).forEach(person => {
        html += `<li style="margin-bottom: 12px; font-size: 14px; line-height: 1.4;">
          <a href="${person.profileUrl}" target="_blank" style="font-weight: 600; color: #191919; text-decoration: none;">${person.name}</a>`;
        
        person.experiences.forEach(conn => {
          const startStr = `${monthNames[conn.overlap.start.getMonth()]} ${conn.overlap.start.getFullYear()}`;
          const endStr = (conn.overlap.end.getFullYear() === now.getFullYear() && conn.overlap.end.getMonth() === now.getMonth()) ? 'Present' : `${monthNames[conn.overlap.end.getMonth()]} ${conn.overlap.end.getFullYear()}`;
          html += `<span style="display: block; color: #5e5e5e; margin-top: 4px;">
            <strong>${conn.company}</strong> - <em>${conn.savedTitle}</em>
            <span style="display: block; color: #006097; font-size: 13px;">Overlap: ${startStr} – ${endStr}</span>
          </span>`;
        });
        html += `</li>`;
      });
      html += '</ul>';
      resultsContainer.innerHTML = html;
    } else {
      resultsContainer.innerHTML = '<p style="color: #5e5e5e; font-size: 14px; text-align: center;">No overlapping work history found.</p>';
    }
    btn.disabled = false;
    btn.textContent = 'Find Shared Connections';
  }
  
  function displaySavedProfiles() {
    const container = document.getElementById('saved-profiles-list');
    if (!container) return;

    chrome.storage.local.get(['profiles'], (result) => {
      const profiles = Object.values(result.profiles || {});
      if (profiles.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #666; padding: 20px 0;">No profiles saved yet.</p>';
        return;
      }
      const html = profiles.map(profile => {
        if (!profile) return ''; 
        return `
        <div class="profile-card" style="background: #f9f9f9; border: 1px solid #ddd; border-radius: 4px; padding: 10px; margin-bottom: 10px;">
          <button class="delete-btn" data-url="${profile.profileUrl}" style="float: right; background: #dc3545; color: white; border: none; padding: 4px 8px; border-radius: 3px; cursor: pointer; font-size: 12px;">Delete</button>
          <a href="${profile.profileUrl}" target="_blank" style="text-decoration: none;">
            <div style="font-weight: bold; color: #0077b5; margin-bottom: 5px;">${profile.name || 'Unknown'}</div>
            <div style="color: #666; font-size: 14px;">${profile.currentTitle || 'No title'}</div>
          </a>
        </div>
      `}).join('');
      container.innerHTML = html;

      container.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const profileUrlToDelete = e.target.dataset.url;
          chrome.storage.local.get(['profiles'], (res) => {
            const profilesObj = res.profiles || {};
            delete profilesObj[profileUrlToDelete];
            chrome.storage.local.set({ profiles: profilesObj }, () => {
              displaySavedProfiles(); 
            });
          });
        });
      });
    });
  }

  function extractProfileData() {
    const profileData = { name: '', profileUrl: '', currentTitle: '', workExperience: [], extractedAt: new Date().toISOString() };
    const currentUrl = window.location.href;
    const profileMatch = currentUrl.match(/linkedin\.com\/in\/([^\/?\#]+)/);
    if (profileMatch) { profileData.profileUrl = `https://www.linkedin.com/in/${profileMatch[1]}/`; }
    const h1Elements = document.querySelectorAll('h1');
    for (const h1 of h1Elements) {
      const text = h1.textContent.trim();
      if (text && !text.includes('Experience') && !text.includes('Education') && text.length < 50) { profileData.name = text; break; }
    }
    if (!profileData.name && document.title) {
      const titleMatch = document.title.match(/^([^|(\-]+)/);
      if (titleMatch) { profileData.name = titleMatch[1].trim(); }
    }
    const titleElement = document.querySelector('.text-body-medium.break-words');
    if (titleElement) { profileData.currentTitle = titleElement.textContent.trim(); }
    if (window.location.href.includes('/details/experience/')) { extractExperienceFromDetailsPage(profileData); } 
    else { extractExperienceFromMainPage(profileData); }
    return profileData;
  }

  function extractExperienceFromDetailsPage(profileData) {
    const experienceContainers = document.querySelectorAll('.scaffold-finite-scroll__content > ul > li');
    experienceContainers.forEach((container) => {
      if (!container.textContent.trim()) return;
      const experiences = extractExperienceFromContainer(container);
      experiences.forEach(exp => {
        if (exp.title || exp.company) { 
          profileData.workExperience.push(exp); 
        }
      });
    });
  }

  function extractExperienceFromMainPage(profileData) {
    const experienceSection = document.querySelector('section:has(#experience)') || document.querySelector('[data-view-name="profile-card"][aria-label*="Experience"]');
    if (experienceSection) {
      const experienceItems = experienceSection.querySelectorAll(':scope > div > ul > li, :scope > ul > li');
      experienceItems.forEach((item) => {
        const experiences = extractExperienceFromContainer(item);
        experiences.forEach(exp => {
          if (exp.title || exp.company) {
            profileData.workExperience.push(exp);
          }
        });
      });
    }
  }

  function extractExperienceFromContainer(container) {
    const experiences = [];
    
    // Check if this is multiple positions at same company
    const subComponents = container.querySelector('.pvs-entity__sub-components');
    
    if (subComponents) {
      // If this is a grouped experience then extract the company name first
      let companyName = '';
      
      const companyElement = container.querySelector('div.display-flex.align-items-center.mr1.hoverable-link-text.t-bold > span[aria-hidden="true"]');
      if (companyElement) {
        companyName = companyElement.textContent.trim();
      }
      
      const positionItems = subComponents.querySelectorAll(':scope > ul > li');
      positionItems.forEach(posItem => {
        const experience = { company: companyName, title: '', duration: '', location: '', description: '' };
        
        // Extract title
        const titleElement = posItem.querySelector('div.display-flex.align-items-center.mr1.hoverable-link-text.t-bold > span[aria-hidden="true"]');
        if (titleElement) {
          experience.title = titleElement.textContent.trim();
        }
        
        // Extract duration 
        const durationElement = posItem.querySelector('.pvs-entity__caption-wrapper');
        if (durationElement) {
          const durationText = durationElement.textContent.trim();
          if (durationText.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Present|\d{4})/)) {
            experience.duration = durationText;
          }
        }
        
        // Extract location
        const allSpans = posItem.querySelectorAll('span[aria-hidden="true"]');
        allSpans.forEach(span => {
          const text = span.textContent.trim();
          if (text.includes(',') && !text.includes('·') && text.length > 5 && !text.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Present|\d{4})/)) {
            experience.location = text;
          }
        });
        
        // Extract description
        const descElement = posItem.querySelector('.inline-show-more-text');
        if (descElement) {
          experience.description = descElement.textContent.trim();
        }
        
        if (experience.title || experience.duration) {
          experiences.push(experience);
        }
      });
    } else {
      const experience = { company: '', title: '', duration: '', location: '', description: '' };
      
      const allSpans = container.querySelectorAll('span[aria-hidden="true"]');
      const spanTexts = Array.from(allSpans).map(s => s.textContent.trim()).filter(Boolean);
      
      const isDatePattern = (text) => {
        const dateRegex = /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}/;
        return dateRegex.test(text) && text.includes('-');
      };
      
      let titleFound = false;
      let companyFound = false;
      
      spanTexts.forEach((text, index) => {
        if (!text) return;
        
        if (isDatePattern(text)) {
          if (!experience.duration) {
            experience.duration = text;
          }
        }
        else if (text.includes(',') && !text.includes('·') && !isDatePattern(text)) {
          if (!experience.location) {
            experience.location = text;
          }
        }
        else if (text.includes('·') && !isDatePattern(text)) {
          const parts = text.split('·');
          if (!companyFound) {
            experience.company = parts[0].trim();
            companyFound = true;
          }
        }
        else if (!titleFound && !isDatePattern(text)) {
          experience.title = text;
          titleFound = true;
        }
        else if (!companyFound && !isDatePattern(text)) {
          experience.company = text;
          companyFound = true;
        }
      });
      
      // Check if company and duration were swapped and swap back
      if (isDatePattern(experience.company) && experience.duration && !isDatePattern(experience.duration)) {
        const temp = experience.company;
        experience.company = experience.duration.split('·')[0].trim();
        experience.duration = temp;
      }
      
      const showMoreSection = container.querySelector('[data-view-name="profile-component-entity-content"]');
      if (showMoreSection) {
        experience.description = showMoreSection.textContent.trim();
      }
      
      if (experience.title || experience.company) {
        experiences.push(experience);
      }
    }
    
    return experiences;
  }

  function loadNotes() {
    if (!currentProfileUrl) return;
    
    chrome.storage.local.get(['notes'], (result) => {
      const notes = result.notes || {};
      const profileNotes = notes[currentProfileUrl] || '';
      const notesTextarea = document.getElementById('profile-notes-textarea');
      if (notesTextarea) {
        notesTextarea.value = profileNotes;
      }
    });
  }

  function saveNotes() {
    if (!currentProfileUrl) return;
    
    const notesTextarea = document.getElementById('profile-notes-textarea');
    if (!notesTextarea) return;
    
    const noteText = notesTextarea.value.trim();
    
    chrome.storage.local.get(['notes'], (result) => {
      const notes = result.notes || {};
      if (noteText) {
        notes[currentProfileUrl] = noteText;
      } else {
        delete notes[currentProfileUrl];
      }
      
      chrome.storage.local.set({ notes }, () => {
        showStatus('Notes saved!', 'success');
      });
    });
  }

  function createFloatingWidget() {
    if (floatingWidget) return;
    
    // Extract current profile info
    const profileData = extractProfileData();
    currentProfileUrl = profileData.profileUrl;
    currentProfileName = profileData.name;
    
    floatingWidget = document.createElement('div');
    floatingWidget.id = 'linkedin-ref-widget';
    floatingWidget.style.cssText = `position: fixed; bottom: 20px; right: 20px; background: white; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.15); padding: 0; z-index: 9999; font-family: -apple-system, sans-serif; width: 340px; max-height: 90vh; display: flex; flex-direction: column;`;
    floatingWidget.innerHTML = `
      <div style="padding: 15px 20px; border-bottom: 1px solid #ddd;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <h3 style="margin: 0; font-size: 18px; color: #0077b5;">LinkedIn Reference Checker</h3>
          <button id="close-widget" style="background: none; border: none; font-size: 20px; cursor: pointer; color: #666;">×</button>
        </div>
      </div>
      <div id="widget-tabs" style="display: flex; background: #f3f2ef; border-bottom: 1px solid #ddd;">
        <button class="widget-tab active" data-tab="connections" style="flex: 1; padding: 10px; border: none; background: white; font-size: 14px; font-weight: bold; color: #0077b5; border-bottom: 2px solid #0077b5; cursor: pointer;">Find Connections</button>
        <button class="widget-tab" data-tab="notes" style="flex: 1; padding: 10px; border: none; background: none; font-size: 14px; cursor: pointer; color: #333;">Notes</button>
        <button class="widget-tab" data-tab="saved" style="flex: 1; padding: 10px; border: none; background: none; font-size: 14px; cursor: pointer; color: #333;">View Saved</button>
      </div>
      <div style="padding: 20px; overflow-y: auto;">
        <div id="connections-content">
          <button id="save-profile-btn" style="width: 100%; padding: 12px; background: #0077b5; color: white; border: none; border-radius: 8px; font-size: 16px; font-weight: 600; cursor: pointer; margin-bottom: 10px;">Save This Profile</button>
          <button id="find-connections-btn" style="width: 100%; padding: 12px; background: #eef3f8; color: #0a66c2; border: 1px solid #d1e0ee; border-radius: 8px; font-size: 16px; font-weight: 600; cursor: pointer;">Find Shared Connections</button>
          <div id="status-message" style="margin-top: 10px; padding: 10px; border-radius: 6px; font-size: 14px; display: none;"></div>
          <div id="cross-reference-results" style="display: none; border-top: 1px solid #e0e0ee; margin-top: 20px; padding-top: 5px;"></div>
        </div>
        <div id="notes-content" style="display: none;">
          <div style="margin-bottom: 10px;">
            <h4 style="margin: 0 0 5px 0; color: #333; font-size: 16px;">Notes for ${currentProfileName || 'this profile'}</h4>
            <p style="margin: 0; color: #666; font-size: 13px;">Private notes visible only to you</p>
          </div>
          <textarea id="profile-notes-textarea" placeholder="Add your notes about this person..." style="width: 100%; height: 200px; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; font-family: inherit; resize: vertical; box-sizing: border-box;"></textarea>
          <button id="save-notes-btn" style="width: 100%; padding: 12px; background: #0077b5; color: white; border: none; border-radius: 8px; font-size: 16px; font-weight: 600; cursor: pointer; margin-top: 10px;">Save Notes</button>
        </div>
        <div id="saved-content" style="display: none;">
          <div id="saved-profiles-list"></div>
        </div>
      </div>
    `;

    document.body.appendChild(floatingWidget);
    document.getElementById('close-widget').addEventListener('click', () => { floatingWidget.remove(); floatingWidget = null; });
    document.getElementById('save-profile-btn').addEventListener('click', saveProfile);
    document.getElementById('find-connections-btn').addEventListener('click', findAndDisplayMatches);
    document.getElementById('save-notes-btn').addEventListener('click', saveNotes);

    const tabs = floatingWidget.querySelectorAll('.widget-tab');
    const connectionsContent = document.getElementById('connections-content');
    const notesContent = document.getElementById('notes-content');
    const savedContent = document.getElementById('saved-content');
    
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => {
          t.classList.remove('active');
          t.style.background = 'none'; t.style.fontWeight = 'normal'; t.style.color = '#333'; t.style.borderBottom = 'none';
        });
        tab.classList.add('active');
        tab.style.background = 'white'; tab.style.fontWeight = 'bold'; tab.style.color = '#0077b5'; tab.style.borderBottom = '2px solid #0077b5';

        if (tab.dataset.tab === 'connections') {
          connectionsContent.style.display = 'block';
          notesContent.style.display = 'none';
          savedContent.style.display = 'none';
        } else if (tab.dataset.tab === 'notes') {
          connectionsContent.style.display = 'none';
          notesContent.style.display = 'block';
          savedContent.style.display = 'none';
          loadNotes();
        } else {
          connectionsContent.style.display = 'none';
          notesContent.style.display = 'none';
          savedContent.style.display = 'block';
          displaySavedProfiles();
        }
      });
    });
    
    loadNotes();
  }

  function showStatus(message, type = 'info') {
    const statusEl = document.getElementById('status-message');
    if (!statusEl) return;
    statusEl.style.display = 'block'; statusEl.textContent = message;
    if (type === 'success') { statusEl.style.background = '#d4edda'; statusEl.style.color = '#155724'; } 
    else if (type === 'error') { statusEl.style.background = '#f8d7da'; statusEl.style.color = '#721c24'; } 
    else { statusEl.style.background = '#d1ecf1'; statusEl.style.color = '#0c5460'; }
    
    setTimeout(() => {
      if (statusEl) statusEl.style.display = 'none';
    }, 3000);
  }

  function saveProfile() {
    const btn = document.getElementById('save-profile-btn');
    if(!btn) return;
    btn.disabled = true; btn.innerHTML = 'Extracting...';
    setTimeout(() => {
      const profileData = extractProfileData();
      if (!profileData.name || !profileData.profileUrl) {
        showStatus('Could not extract profile name. Please try on the main profile page.', 'error');
        btn.disabled = false; btn.innerHTML = `Save This Profile`;
        return;
      }
      chrome.storage.local.get(['profiles'], (result) => {
        const profiles = result.profiles || {};
        profiles[profileData.profileUrl] = { ...profileData, lastUpdated: new Date().toISOString() };
        chrome.storage.local.set({ profiles }, () => {
          showStatus(`${profileData.name} has been saved!`, 'success');
          btn.disabled = false; btn.innerHTML = `Saved!`;
          setTimeout(() => { if (btn) { btn.innerHTML = `Save This Profile`; } }, 2000);
        });
      });
    }, 500);
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "saveProfile") {
      if (!floatingWidget) { createFloatingWidget(); }
      saveProfile();
      sendResponse({ status: "Profile save initiated" });
    }
    return true;
  });

  function init() {
    if (window.location.href.includes('linkedin.com/in/')) {
      if (!floatingWidget) { createFloatingWidget(); }
    }
  }

  let lastUrl = location.href;
  new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
      lastUrl = url;
      if (url.includes('linkedin.com/in/')) { 
        if (floatingWidget) { 
          floatingWidget.remove(); 
          floatingWidget = null; 
        }
        setTimeout(init, 1000); 
      } 
      else if (floatingWidget) { 
        floatingWidget.remove(); 
        floatingWidget = null; 
      }
    }
  }).observe(document, { subtree: true, childList: true });

  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', init); } 
  else { init(); }
})();