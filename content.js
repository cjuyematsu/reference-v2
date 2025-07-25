// content.js

(function() {
  let floatingWidget = null;
  let currentProfileUrl = null;
  let currentProfileName = null;
  let isCollapsed = false;
  let selectedNoteId = null;
  let isDragging = false;
  let dragOffset = { x: 0, y: 0 };
  let isProfilePage = false;

  // Check if extension context is still valid
  function isContextValid() {
    try {
      return chrome.runtime && chrome.runtime.id;
    } catch (e) {
      return false;
    }
  }

  // Safe chrome storage operation
  function safeStorageOperation(operation, callback) {
    if (!isContextValid()) {
      console.warn('Extension context invalidated');
      return;
    }
    
    try {
      operation(callback);
    } catch (error) {
      console.error('Storage operation failed:', error);
    }
  }

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

  // Generate unique ID for notes
  function generateNoteId() {
    return 'note-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
  }

  // Format date for note display
  function formatNoteDate(dateStr) {
    const date = new Date(dateStr);
    const now = new Date();
    const diffTime = Math.abs(now - date);
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) {
      return 'Today';
    } else if (diffDays === 1) {
      return 'Yesterday';
    } else if (diffDays < 7) {
      return `${diffDays} days ago`;
    } else {
      return date.toLocaleDateString();
    }
  }

  // Get note preview (first line or title)
  function getNotePreview(content) {
    if (!content) return 'New note';
    const lines = content.trim().split('\n');
    const firstLine = lines[0].trim();
    return firstLine.substring(0, 50) + (firstLine.length > 50 ? '...' : '');
  }

  // Check if we're on a profile page
  function checkIfProfilePage() {
    const url = window.location.href;
    return url.includes('linkedin.com/in/') && !url.includes('/details/');
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

    safeStorageOperation(
      (callback) => chrome.storage.local.get(['profiles'], callback),
      (result) => {
        if (chrome.runtime.lastError) {
          console.error("Storage error:", chrome.runtime.lastError.message);
          btn.disabled = false; 
          btn.textContent = 'Find Shared Connections';
          resultsContainer.innerHTML = '<p style="color: red;">An error occurred. Please try again.</p>';
          return;
        }
        
        const savedProfiles = Object.values(result.profiles || {});
        
        const currentPageExperiences = currentPageData.workExperience || [];

        if (savedProfiles.length === 0 || currentPageExperiences.length === 0) {
          console.error("DEBUG: Search stopped. Missing saved profiles or current page experience data.");
          resultsContainer.innerHTML = '<p style="color: #666;">Not enough data to run a search. Please save profiles and ensure the current page has work experience listed.</p>';
          btn.disabled = false; 
          btn.textContent = 'Find Shared Connections';
          return;
        }

        const connections = [];
        
        for (const savedProfile of savedProfiles) {
          if (!savedProfile || !savedProfile.profileUrl || savedProfile.profileUrl === currentPageData.profileUrl) { 
            continue; 
          }

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
    );
  }
  
  function displaySavedProfiles() {
    const container = document.getElementById('saved-profiles-list');
    if (!container) return;

    safeStorageOperation(
      (callback) => chrome.storage.local.get(['profiles'], callback),
      (result) => {
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
            safeStorageOperation(
              (callback) => chrome.storage.local.get(['profiles'], callback),
              (res) => {
                const profilesObj = res.profiles || {};
                delete profilesObj[profileUrlToDelete];
                safeStorageOperation(
                  (callback) => chrome.storage.local.set({ profiles: profilesObj }, callback),
                  () => displaySavedProfiles()
                );
              }
            );
          });
        });
      }
    );
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
    
    const subComponents = container.querySelector('.pvs-entity__sub-components');
    
    if (subComponents) {
      let companyName = '';
      
      const companyElement = container.querySelector('div.display-flex.align-items-center.mr1.hoverable-link-text.t-bold > span[aria-hidden="true"]');
      if (companyElement) {
        companyName = companyElement.textContent.trim();
      }
      
      const positionItems = subComponents.querySelectorAll(':scope > ul > li');
      positionItems.forEach(posItem => {
        const experience = { company: companyName, title: '', duration: '', location: '', description: '' };
        
        const titleElement = posItem.querySelector('div.display-flex.align-items-center.mr1.hoverable-link-text.t-bold > span[aria-hidden="true"]');
        if (titleElement) {
          experience.title = titleElement.textContent.trim();
        }
        
        const durationElement = posItem.querySelector('.pvs-entity__caption-wrapper');
        if (durationElement) {
          const durationText = durationElement.textContent.trim();
          if (durationText.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Present|\d{4})/)) {
            experience.duration = durationText;
          }
        }
        
        const allSpans = posItem.querySelectorAll('span[aria-hidden="true"]');
        allSpans.forEach(span => {
          const text = span.textContent.trim();
          if (text.includes(',') && !text.includes('·') && text.length > 5 && !text.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Present|\d{4})/)) {
            experience.location = text;
          }
        });
        
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

  // Load and display notes for current profile
  function loadNotes() {
    if (!isProfilePage || !currentProfileUrl) {
      // Show message when not on a profile page
      const notesList = document.getElementById('notes-list');
      const editor = document.getElementById('note-editor');
      if (notesList) {
        notesList.innerHTML = '<div style="text-align: center; color: #999; padding: 20px;">Navigate to a profile page to view notes.</div>';
      }
      if (editor) {
        editor.style.display = 'none';
      }
      return;
    }
    
    safeStorageOperation(
      (callback) => chrome.storage.local.get(['notes'], callback),
      (result) => {
        const allNotes = result.notes || {};
        const profileNotes = allNotes[currentProfileUrl] || [];
        displayNotes(profileNotes);
      }
    );
  }

  // Display notes in the sidebar
  function displayNotes(notes) {
    const notesList = document.getElementById('notes-list');
    if (!notesList) return;

    if (!isProfilePage) {
      notesList.innerHTML = '<div style="text-align: center; color: #999; padding: 20px;">Navigate to a profile page to view notes.</div>';
      return;
    }

    if (notes.length === 0) {
      notesList.innerHTML = '<div style="text-align: center; color: #999; padding: 20px;">No notes yet. Click + to add a note.</div>';
      selectedNoteId = null;
      const editor = document.getElementById('note-editor');
      if (editor) editor.style.display = 'none';
      return;
    }

    notesList.innerHTML = notes.map(note => `
      <div class="note-item ${selectedNoteId === note.id ? 'selected' : ''}" data-note-id="${note.id}" style="padding: 10px; border-bottom: 1px solid #eee; cursor: pointer; ${selectedNoteId === note.id ? 'background: #e3f2fd;' : ''} transition: background 0.2s;">
        <div style="font-weight: 500; color: #333; margin-bottom: 4px;">${getNotePreview(note.content)}</div>
        <div style="font-size: 12px; color: #999;">${formatNoteDate(note.createdAt)}</div>
      </div>
    `).join('');

    // Add click handlers
    notesList.querySelectorAll('.note-item').forEach(item => {
      item.addEventListener('click', () => {
        const noteId = item.dataset.noteId;
        selectNote(noteId);
      });
    });

    // If no note is selected, select the first one
    if (!selectedNoteId && notes.length > 0) {
      selectNote(notes[0].id);
    } else if (selectedNoteId) {
      // Make sure the selected note still exists
      const noteExists = notes.find(n => n.id === selectedNoteId);
      if (noteExists) {
        selectNote(selectedNoteId);
      } else {
        selectedNoteId = null;
        const editor = document.getElementById('note-editor');
        if (editor) editor.style.display = 'none';
      }
    }
  }

  // Select and display a note
  function selectNote(noteId) {
    selectedNoteId = noteId;
    
    safeStorageOperation(
      (callback) => chrome.storage.local.get(['notes'], callback),
      (result) => {
        const allNotes = result.notes || {};
        const profileNotes = allNotes[currentProfileUrl] || [];
        const note = profileNotes.find(n => n.id === noteId);
        
        if (note) {
          const editor = document.getElementById('note-editor');
          const textarea = document.getElementById('note-textarea');
          
          if (editor && textarea) {
            editor.style.display = 'block';
            textarea.value = note.content;
            
            // Update visual selection
            document.querySelectorAll('.note-item').forEach(item => {
              if (item.dataset.noteId === noteId) {
                item.classList.add('selected');
                item.style.background = '#e3f2fd';
              } else {
                item.classList.remove('selected');
                item.style.background = '';
              }
            });
          }
        }
      }
    );
  }

  // Create a new note
  function createNewNote() {
    if (!isProfilePage) {
      showStatus('Please navigate to a profile page to add notes.', 'error');
      return;
    }

    const newNote = {
      id: generateNoteId(),
      content: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    safeStorageOperation(
      (callback) => chrome.storage.local.get(['notes'], callback),
      (result) => {
        const allNotes = result.notes || {};
        const profileNotes = allNotes[currentProfileUrl] || [];
        
        profileNotes.unshift(newNote);
        allNotes[currentProfileUrl] = profileNotes;
        
        safeStorageOperation(
          (callback) => chrome.storage.local.set({ notes: allNotes }, callback),
          () => {
            selectedNoteId = newNote.id;
            loadNotes();
            
            // Focus the textarea
            setTimeout(() => {
              const textarea = document.getElementById('note-textarea');
              if (textarea) textarea.focus();
            }, 100);
          }
        );
      }
    );
  }

  // Save the current note
  function saveCurrentNote() {
    if (!selectedNoteId) return;
    
    const textarea = document.getElementById('note-textarea');
    if (!textarea) return;
    
    const content = textarea.value.trim();
    
    safeStorageOperation(
      (callback) => chrome.storage.local.get(['notes'], callback),
      (result) => {
        const allNotes = result.notes || {};
        const profileNotes = allNotes[currentProfileUrl] || [];
        
        const noteIndex = profileNotes.findIndex(n => n.id === selectedNoteId);
        if (noteIndex !== -1) {
          if (content) {
            profileNotes[noteIndex].content = content;
            profileNotes[noteIndex].updatedAt = new Date().toISOString();
          } else {
            // Delete empty notes
            profileNotes.splice(noteIndex, 1);
            selectedNoteId = null;
          }
          
          allNotes[currentProfileUrl] = profileNotes;
          safeStorageOperation(
            (callback) => chrome.storage.local.set({ notes: allNotes }, callback),
            () => {
              showStatus('Note saved!', 'success');
              loadNotes();
            }
          );
        }
      }
    );
  }

  // Delete the current note
  function deleteCurrentNote() {
    if (!selectedNoteId || !confirm('Delete this note?')) return;
    
    safeStorageOperation(
      (callback) => chrome.storage.local.get(['notes'], callback),
      (result) => {
        const allNotes = result.notes || {};
        const profileNotes = allNotes[currentProfileUrl] || [];
        
        const noteIndex = profileNotes.findIndex(n => n.id === selectedNoteId);
        if (noteIndex !== -1) {
          profileNotes.splice(noteIndex, 1);
          allNotes[currentProfileUrl] = profileNotes;
          
          selectedNoteId = null;
          safeStorageOperation(
            (callback) => chrome.storage.local.set({ notes: allNotes }, callback),
            () => {
              showStatus('Note deleted!', 'success');
              loadNotes();
            }
          );
        }
      }
    );
  }

  // Drag functionality
  function startDrag(e) {
    isDragging = true;
    const rect = floatingWidget.getBoundingClientRect();
    dragOffset.x = e.clientX - rect.left;
    dragOffset.y = e.clientY - rect.top;
    floatingWidget.style.cursor = 'grabbing';
  }

  function drag(e) {
    if (!isDragging || !floatingWidget) return;
    
    e.preventDefault();
    const newX = e.clientX - dragOffset.x;
    const newY = e.clientY - dragOffset.y;
    
    // Keep widget within viewport
    const maxX = window.innerWidth - floatingWidget.offsetWidth;
    const maxY = window.innerHeight - floatingWidget.offsetHeight;
    
    const finalX = Math.max(0, Math.min(newX, maxX));
    const finalY = Math.max(0, Math.min(newY, maxY));
    
    floatingWidget.style.left = finalX + 'px';
    floatingWidget.style.top = finalY + 'px';
    floatingWidget.style.right = 'auto';
    floatingWidget.style.bottom = 'auto';
  }

  function stopDrag() {
    isDragging = false;
    if (floatingWidget) {
      floatingWidget.style.cursor = '';
    }
  }

  function createFloatingWidget() {
    if (floatingWidget) return;
    
    // Check if we're on a profile page
    isProfilePage = checkIfProfilePage();
    
    // Extract current profile info if on profile page
    if (isProfilePage) {
      const profileData = extractProfileData();
      currentProfileUrl = profileData.profileUrl;
      currentProfileName = profileData.name;
    }
    
    // Load saved collapse state
    const savedCollapsed = localStorage.getItem('linkedin-widget-collapsed') === 'true';
  isCollapsed = savedCollapsed;
    
    floatingWidget = document.createElement('div');
    floatingWidget.id = 'linkedin-ref-widget';
    floatingWidget.style.cssText = `position: fixed; bottom: 20px; right: 20px; background: white; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.15); padding: 0; z-index: 9999; font-family: -apple-system, sans-serif; width: 340px; max-height: ${isCollapsed ? '50px' : '90vh'}; display: flex; flex-direction: column; transition: max-height 0.3s ease; overflow: hidden;`;
    
    floatingWidget.innerHTML = `
    <div id="widget-header" style="
        position: relative; 
        display: flex; 
        align-items: center; 
        justify-content: center;
        padding: 15px 20px; 
        border-bottom: ${isCollapsed ? 'none' : '1px solid #ddd'}; 
        cursor: grab;
        background-color: #f7f7f7;
    ">
        <button id="toggle-widget" style="
            position: absolute; 
            left: 15px;
            top: 50%;
            transform: translateY(-50%);
            background: none; 
            border: none; 
            cursor: pointer;
            padding: 0;
            color: #666;
        ">
            <svg width="24" height="24" fill="currentColor" viewBox="0 0 24 24">
                <path d="M4 6h16v2H4zM4 11h16v2H4zM4 16h16v2H4z"/>
            </svg>
        </button>

        <h3 style="
            margin: 0; 
            font-size: 18px; 
            color: #0077b5; 
            user-select: none;
        ">
            Reference Checker
        </h3>

        <button id="close-widget" style="
            position: absolute; 
            right: 15px;
            top: 50%;
            transform: translateY(-50%);
            background: none; 
            border: none; 
            cursor: pointer;
            padding: 0;
            color: #666;
        ">
            <svg width="24" height="24" fill="currentColor" viewBox="0 0 24 24">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/>
            </svg>
        </button>
    </div>
      <div id="widget-tabs" style="display: ${isCollapsed ? 'none' : 'flex'}; background: #f3f2ef; border-bottom: 1px solid #ddd;">
        ${isProfilePage ? '<button class="widget-tab active" data-tab="connections" style="flex: 1; padding: 10px; border: none; background: white; font-size: 14px; font-weight: bold; color: #0077b5; border-bottom: 2px solid #0077b5; cursor: pointer;">Find Connections</button>' : ''}
        <button class="widget-tab ${!isProfilePage ? 'active' : ''}" data-tab="notes" style="flex: 1; padding: 10px; border: none; background: ${!isProfilePage ? 'white' : 'none'}; font-size: 14px; font-weight: ${!isProfilePage ? 'bold' : 'normal'}; color: ${!isProfilePage ? '#0077b5' : '#333'}; border-bottom: ${!isProfilePage ? '2px solid #0077b5' : 'none'}; cursor: pointer;">Notes</button>
        <button class="widget-tab" data-tab="saved" style="flex: 1; padding: 10px; border: none; background: none; font-size: 14px; cursor: pointer; color: #333;">View Saved</button>
      </div>
      <div style="padding: 20px; overflow-y: auto; display: ${isCollapsed ? 'none' : 'block'};">
        <div id="connections-content" style="display: ${isProfilePage ? 'block' : 'none'};">
          <button id="save-profile-btn" style="width: 100%; padding: 12px; background: #0077b5; color: white; border: none; border-radius: 8px; font-size: 16px; font-weight: 600; cursor: pointer; margin-bottom: 10px;">Save This Profile</button>
          <button id="find-connections-btn" style="width: 100%; padding: 12px; background: #eef3f8; color: #0a66c2; border: 1px solid #d1e0ee; border-radius: 8px; font-size: 16px; font-weight: 600; cursor: pointer;">Find Shared Connections</button>
          <div id="status-message" style="margin-top: 10px; padding: 10px; border-radius: 6px; font-size: 14px; display: none;"></div>
          <div id="cross-reference-results" style="display: none; border-top: 1px solid #e0e0ee; margin-top: 20px; padding-top: 5px;"></div>
        </div>
        <div id="notes-content" style="display: ${!isProfilePage ? 'block' : 'none'};">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
            <h4 style="margin: 0; color: #333; font-size: 16px;">${isProfilePage ? `Notes for ${currentProfileName || 'this profile'}` : 'Notes'}</h4>
            ${isProfilePage ? '<button id="add-note-btn" style="background: #0077b5; color: white; border: none; padding: 6px 12px; border-radius: 4px; font-size: 20px; cursor: pointer; font-weight: bold;">+</button>' : ''}
          </div>
          <div style="display: flex; gap: 15px; height: 300px;">
            <div id="notes-list" style="flex: 0 0 150px; border: 1px solid #ddd; border-radius: 4px; overflow-y: auto; background: #f9f9f9;"></div>
            <div id="note-editor" style="flex: 1; display: none;">
              <textarea id="note-textarea" placeholder="Start typing your note..." style="width: 100%; height: 240px; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; font-family: inherit; resize: none; box-sizing: border-box;"></textarea>
              <div style="display: flex; gap: 10px; margin-top: 10px;">
                <button id="save-note-btn" style="flex: 1; padding: 8px; background: #0077b5; color: white; border: none; border-radius: 4px; font-size: 14px; font-weight: 600; cursor: pointer;">Save</button>
                <button id="delete-note-btn" style="padding: 8px 16px; background: #dc3545; color: white; border: none; border-radius: 4px; font-size: 14px; cursor: pointer;">Delete</button>
              </div>
            </div>
          </div>
        </div>
        <div id="saved-content" style="display: none;">
          <div id="saved-profiles-list"></div>
        </div>
      </div>
      <div id="widget-footer" style="padding: 4px; text-align: center; font-size: 10px; color: #666; border-top: 1px solid #ddd;">
        <span>Independent of LinkedIn</span>
      </div>
    `;

    document.body.appendChild(floatingWidget);
    
    // Add drag functionality to header
    const header = document.getElementById('widget-header');
    header.addEventListener('mousedown', startDrag);
    document.addEventListener('mousemove', drag);
    document.addEventListener('mouseup', stopDrag);
    
    // Event listeners
    document.getElementById('close-widget').addEventListener('click', () => { 
      floatingWidget.remove(); 
      floatingWidget = null; 
    });
    
    document.getElementById('toggle-widget').addEventListener('click', () => {
      isCollapsed = !isCollapsed;
      localStorage.setItem('linkedin-widget-collapsed', isCollapsed);
      
      const tabs = document.getElementById('widget-tabs');
      const content = floatingWidget.querySelector('div[style*="padding: 20px"]');
      
      floatingWidget.style.maxHeight = isCollapsed ? '50px' : '90vh';
      tabs.style.display = isCollapsed ? 'none' : 'flex';
      content.style.display = isCollapsed ? 'none' : 'block';
      
      // Update border
      const header = floatingWidget.querySelector('div[style*="padding: 15px 20px"]');
      header.style.borderBottom = isCollapsed ? 'none' : '1px solid #ddd';
    });
    
    // Only add these listeners if on profile page
    if (isProfilePage) {
      const saveBtn = document.getElementById('save-profile-btn');
      const findBtn = document.getElementById('find-connections-btn');
      if (saveBtn) saveBtn.addEventListener('click', saveProfile);
      if (findBtn) findBtn.addEventListener('click', findAndDisplayMatches);
    }
    
    const addNoteBtn = document.getElementById('add-note-btn');
    const saveNoteBtn = document.getElementById('save-note-btn');
    const deleteNoteBtn = document.getElementById('delete-note-btn');
    
    if (addNoteBtn) addNoteBtn.addEventListener('click', createNewNote);
    if (saveNoteBtn) saveNoteBtn.addEventListener('click', saveCurrentNote);
    if (deleteNoteBtn) deleteNoteBtn.addEventListener('click', deleteCurrentNote);

    const tabs = floatingWidget.querySelectorAll('.widget-tab');
    const connectionsContent = document.getElementById('connections-content');
    const notesContent = document.getElementById('notes-content');
    const savedContent = document.getElementById('saved-content');
    
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => {
          t.classList.remove('active');
          t.style.background = 'none'; 
          t.style.fontWeight = 'normal'; 
          t.style.color = '#333'; 
          t.style.borderBottom = 'none';
        });
        tab.classList.add('active');
        tab.style.background = 'white'; 
        tab.style.fontWeight = 'bold'; 
        tab.style.color = '#0077b5'; 
        tab.style.borderBottom = '2px solid #0077b5';

        if (tab.dataset.tab === 'connections') {
          if (connectionsContent) connectionsContent.style.display = 'block';
          if (notesContent) notesContent.style.display = 'none';
          if (savedContent) savedContent.style.display = 'none';
        } else if (tab.dataset.tab === 'notes') {
          if (connectionsContent) connectionsContent.style.display = 'none';
          if (notesContent) notesContent.style.display = 'block';
          if (savedContent) savedContent.style.display = 'none';
          loadNotes();
        } else {
          if (connectionsContent) connectionsContent.style.display = 'none';
          if (notesContent) notesContent.style.display = 'none';
          if (savedContent) savedContent.style.display = 'block';
          displaySavedProfiles();
        }
      });
    });
    
    // Prevent dragging when clicking buttons or other interactive elements
    floatingWidget.querySelectorAll('button, textarea, input, a').forEach(element => {
      element.addEventListener('mousedown', (e) => {
        e.stopPropagation();
      });
    });
    
    // Load appropriate content
    if (!isProfilePage) {
      // If not on profile page, show notes tab by default
      const notesTab = floatingWidget.querySelector('[data-tab="notes"]');
      if (notesTab) notesTab.click();
    } else {
      loadNotes();
    }
  }

  function showStatus(message, type = 'info') {
    const statusEl = document.getElementById('status-message');
    if (!statusEl) return;
    statusEl.style.display = 'block'; 
    statusEl.textContent = message;
    if (type === 'success') { 
      statusEl.style.background = '#d4edda'; 
      statusEl.style.color = '#155724'; 
    } else if (type === 'error') { 
      statusEl.style.background = '#f8d7da'; 
      statusEl.style.color = '#721c24'; 
    } else { 
      statusEl.style.background = '#d1ecf1'; 
      statusEl.style.color = '#0c5460'; 
    }
    
    // Auto-hide after 3 seconds
    setTimeout(() => {
      if (statusEl) statusEl.style.display = 'none';
    }, 3000);
  }

  function saveProfile() {
    const btn = document.getElementById('save-profile-btn');
    if(!btn) return;
    btn.disabled = true; 
    btn.innerHTML = 'Extracting...';
    setTimeout(() => {
      const profileData = extractProfileData();
      if (!profileData.name || !profileData.profileUrl) {
        showStatus('Could not extract profile name. Please try on the main profile page.', 'error');
        btn.disabled = false; 
        btn.innerHTML = `Save This Profile`;
        return;
      }
      safeStorageOperation(
        (callback) => chrome.storage.local.get(['profiles'], callback),
        (result) => {
          const profiles = result.profiles || {};
          profiles[profileData.profileUrl] = { 
            ...profileData, 
            lastUpdated: new Date().toISOString() 
          };
          safeStorageOperation(
            (callback) => chrome.storage.local.set({ profiles }, callback),
            () => {
              showStatus(`${profileData.name} has been saved!`, 'success');
              btn.disabled = false; 
              btn.innerHTML = `Saved!`;
              setTimeout(() => { 
                if (btn) { 
                  btn.innerHTML = `Save This Profile`; 
                } 
              }, 2000);
            }
          );
        }
      );
    }, 500);
  }

  // Message listener with context check
  if (isContextValid()) {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === "saveProfile") {
        if (!floatingWidget) { 
          createFloatingWidget(); 
        }
        saveProfile();
        sendResponse({ status: "Profile save initiated" });
      }
      return true;
    });
  }

  function init() {
    if (window.location.href.includes('linkedin.com/')) {
      if (!floatingWidget) { 
        createFloatingWidget(); 
      }
    }
  }

  let lastUrl = location.href;
  new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
      lastUrl = url;
      if (url.includes('linkedin.com/')) { 
        // Remove old widget and recreate for new context
        if (floatingWidget) { 
          floatingWidget.remove(); 
          floatingWidget = null; 
        }
        setTimeout(init, 1000); 
      }
    }
  }).observe(document, { subtree: true, childList: true });

  if (document.readyState === 'loading') { 
    document.addEventListener('DOMContentLoaded', init); 
  } else { 
    init(); 
  }
  })();