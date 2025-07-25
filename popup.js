// popup.js
document.addEventListener('DOMContentLoaded', function() {
  const tabs = document.querySelectorAll('.tab');
  const savedContent = document.getElementById('saved-content');
  const searchContent = document.getElementById('search-content');
  const profilesList = document.getElementById('profiles-list');
  const searchInput = document.getElementById('search-input');
  const searchResults = document.getElementById('search-results');
  const stats = document.getElementById('stats');
  
  let allProfiles = [];
  let allNotes = {};

  // Tab switching
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      
      if (tab.dataset.tab === 'saved') {
        savedContent.style.display = 'block';
        searchContent.style.display = 'none';
      } else {
        savedContent.style.display = 'none';
        searchContent.style.display = 'block';
      }
    });
  });

  // Load profiles and notes
  function loadProfiles() {
    chrome.storage.local.get(['profiles', 'notes'], (result) => {
      const profilesObj = result.profiles || {};
      allProfiles = Object.values(profilesObj);
      allNotes = result.notes || {};
      displayProfiles(allProfiles);
      updateStats();
    });
  }

  // Update statistics
  function updateStats() {
    const totalProfiles = allProfiles.length;
    const totalCompanies = new Set(
      allProfiles.flatMap(p => 
        (p.workExperience || []).map(e => e.company).filter(Boolean)
      )
    ).size;
    
    const totalNotesCount = Object.values(allNotes).reduce((acc, notes) => {
      return acc + (Array.isArray(notes) ? notes.length : 0);
    }, 0);
    
    stats.textContent = `${totalProfiles} profiles saved | ${totalCompanies} companies | ${totalNotesCount} notes`;
  }

  // Get preview of notes for a profile
  function getNotesPreview(profileUrl) {
    const notes = allNotes[profileUrl];
    if (!notes || !Array.isArray(notes) || notes.length === 0) return null;
    
    // Get the most recent note
    const sortedNotes = [...notes].sort((a, b) => 
      new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt)
    );
    
    const recentNote = sortedNotes[0];
    const preview = recentNote.content.trim().split('\n')[0].substring(0, 100);
    
    return {
      preview: preview + (preview.length >= 100 ? '...' : ''),
      count: notes.length
    };
  }

  // Display profiles
  function displayProfiles(profiles) {
    if (profiles.length === 0) {
      profilesList.innerHTML = '<div class="empty-state">No profiles saved yet.<br>Visit LinkedIn profiles and click "Save Profile" in the floating widget.</div>';
      return;
    }

    profilesList.innerHTML = profiles.map((profile, index) => {
      const notesInfo = getNotesPreview(profile.profileUrl);
      
      return `
      <div class="profile-card">
        <button class="delete-btn" data-url="${profile.profileUrl}">Delete</button>
        <a href="${profile.profileUrl}" target="_blank" class="view-profile-btn">View Profile</a>
        <div class="profile-name">${profile.name || 'Unknown'}</div>
        <div class="profile-title">${profile.currentTitle || 'No title'}</div>
        ${notesInfo ? `
          <div style="margin-top: 8px; padding: 8px; background: #f0f7ff; border-left: 3px solid #0077b5; border-radius: 2px;">
            <div style="font-size: 12px; color: #0077b5; font-weight: bold; margin-bottom: 4px;">
              Notes (${notesInfo.count}):
            </div>
            <div style="font-size: 13px; color: #333;">${notesInfo.preview}</div>
          </div>
        ` : ''}
        <div style="margin-top: 8px; font-size: 13px; color: #666;">
          <strong>Work Experience:</strong>
        </div>
        ${profile.workExperience && profile.workExperience.length > 0 ? 
          profile.workExperience.slice(0, 3).map(exp => `
            <div class="experience-item">
              • ${exp.title}${exp.company ? ' at ' + exp.company : ''}${exp.duration ? ' (' + exp.duration + ')' : ''}
            </div>
          `).join('') : 
          '<div class="experience-item" style="color: #999;">No work experience found</div>'
        }
        ${profile.workExperience && profile.workExperience.length > 3 ? 
          `<div class="experience-item" style="color: #999;">...and ${profile.workExperience.length - 3} more</div>` : ''}
        <div style="margin-top: 8px; font-size: 11px; color: #999;">
          Saved: ${new Date(profile.lastUpdated || profile.extractedAt).toLocaleDateString()}
        </div>
      </div>
    `}).join('');

    // Add delete functionality
    document.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const profileUrl = e.target.dataset.url;
        
        if (confirm('Delete this profile and all its notes?')) {
          chrome.storage.local.get(['profiles', 'notes'], (result) => {
            const profilesObj = result.profiles || {};
            const notesObj = result.notes || {};
            
            delete profilesObj[profileUrl];
            delete notesObj[profileUrl];
            
            chrome.storage.local.set({ 
              profiles: profilesObj,
              notes: notesObj 
            }, loadProfiles);
          });
        }
      });
    });
  }

  // Search functionality
  searchInput.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    
    if (query.length < 2) {
      searchResults.innerHTML = '<div class="empty-state">Enter at least 2 characters to search</div>';
      return;
    }

    const matches = allProfiles.filter(profile => {
      const nameMatch = (profile.name || '').toLowerCase().includes(query);
      const titleMatch = (profile.currentTitle || '').toLowerCase().includes(query);
      const companyMatch = (profile.workExperience || []).some(exp => 
        (exp.company || '').toLowerCase().includes(query) || 
        (exp.title || '').toLowerCase().includes(query)
      );
      
      // Search in notes
      const profileNotes = allNotes[profile.profileUrl] || [];
      const notesMatch = profileNotes.some(note => 
        (note.content || '').toLowerCase().includes(query)
      );
      
      return nameMatch || titleMatch || companyMatch || notesMatch;
    });

    if (matches.length === 0) {
      searchResults.innerHTML = '<div class="empty-state">No matches found</div>';
      return;
    }

    searchResults.innerHTML = matches.map(profile => {
      const matchingExperiences = (profile.workExperience || []).filter(exp =>
        (exp.company || '').toLowerCase().includes(query) || 
        (exp.title || '').toLowerCase().includes(query)
      );
      
      const profileNotes = allNotes[profile.profileUrl] || [];
      const matchingNotes = profileNotes.filter(note =>
        (note.content || '').toLowerCase().includes(query)
      );

      return `
        <div class="profile-card">
          <a href="${profile.profileUrl}" target="_blank" class="view-profile-btn">View Profile</a>
          <div class="profile-name">${highlightMatch(profile.name || 'Unknown', query)}</div>
          <div class="profile-title">${highlightMatch(profile.currentTitle || '', query)}</div>
          ${matchingNotes.length > 0 ? `
            <div style="margin-top: 8px; padding: 8px; background: #f0f7ff; border-left: 3px solid #0077b5; border-radius: 2px;">
              <div style="font-size: 12px; color: #0077b5; font-weight: bold; margin-bottom: 4px;">Matching Notes:</div>
              ${matchingNotes.slice(0, 2).map(note => {
                const preview = note.content.substring(0, 150);
                return `<div style="font-size: 13px; color: #333; margin-bottom: 4px;">${highlightMatch(preview, query)}${note.content.length > 150 ? '...' : ''}</div>`;
              }).join('')}
              ${matchingNotes.length > 2 ? `<div style="font-size: 12px; color: #666;">...and ${matchingNotes.length - 2} more</div>` : ''}
            </div>
          ` : ''}
          ${matchingExperiences.length > 0 ? `
            <div style="margin-top: 8px; font-size: 13px; color: #666;">
              <strong>Matching Experience:</strong>
            </div>
            ${matchingExperiences.map(exp => `
              <div class="experience-item">
                • ${highlightMatch(exp.title || '', query)} at ${highlightMatch(exp.company || '', query)}
              </div>
            `).join('')}
          ` : ''}
        </div>
      `;
    }).join('');
  });

  function highlightMatch(text, query) {
    if (!text) return '';
    const regex = new RegExp(`(${query})`, 'gi');
    return text.replace(regex, '<span class="match-highlight">$1</span>');
  }

  loadProfiles();
});