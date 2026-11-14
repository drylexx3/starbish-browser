const tabsContainer = document.getElementById('tabs-container');
const btnNewTab = document.getElementById('btn-new-tab');
const btnBack = document.getElementById('btn-back');
const btnForward = document.getElementById('btn-forward');
const btnReload = document.getElementById('btn-reload');
const omnibox = document.getElementById('omnibox');
const btnShield = document.getElementById('btn-shield');
const shieldBadge = document.getElementById('shield-badge');
const shieldPopup = document.getElementById('shield-popup');
const popupBlockedCount = document.getElementById('popup-blocked-count');
const popupBtnClean = document.getElementById('popup-btn-clean');
const btnIdentity = document.getElementById('btn-identity');

const tabsMap = new Map();
let currentActiveTabId = null;

// Omnibox Navigation
omnibox.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const value = omnibox.value.trim();
    if (value) {
      window.starbishAPI.navigate(value);
      omnibox.blur();
    }
  }
});

// New Tab
btnNewTab.addEventListener('click', () => {
  window.starbishAPI.newTab();
});

// History Controls
btnBack.addEventListener('click', () => {
  window.starbishAPI.goBack();
});

btnForward.addEventListener('click', () => {
  window.starbishAPI.goForward();
});

btnReload.addEventListener('click', () => {
  window.starbishAPI.reload();
});

// Shield Popup Toggle
btnShield.addEventListener('click', (e) => {
  e.stopPropagation();
  shieldPopup.classList.toggle('hidden');
});

document.addEventListener('click', (e) => {
  if (!shieldPopup.contains(e.target) && e.target !== btnShield) {
    shieldPopup.classList.add('hidden');
  }
});

// Identity Reset (Amnesic clear)
async function triggerCleanIdentity() {
  const confirmed = confirm('¿Reiniciar Identidad? Se cerrará la sesión actual, borrando todas las cookies, historial y caché temporal al estilo Mullvad Browser.');
  if (confirmed) {
    await window.starbishAPI.resetIdentity();
    shieldPopup.classList.add('hidden');
  }
}

btnIdentity.addEventListener('click', triggerCleanIdentity);
popupBtnClean.addEventListener('click', triggerCleanIdentity);

// Keyboard Shortcuts
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 't') {
    e.preventDefault();
    window.starbishAPI.newTab();
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'w') {
    e.preventDefault();
    if (currentActiveTabId) {
      window.starbishAPI.closeTab(currentActiveTabId);
    }
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
    e.preventDefault();
    omnibox.focus();
    omnibox.select();
  }
});

// IPC Event Listeners
window.starbishAPI.onTabCreated((tab) => {
  createTabElement(tab);
});

window.starbishAPI.onTabUpdated((tab) => {
  updateTabElement(tab);
});

window.starbishAPI.onTabClosed((id) => {
  removeTabElement(id);
});

window.starbishAPI.onShieldStatsUpdated((stats) => {
  const count = stats.totalBlocked || 0;
  shieldBadge.textContent = count;
  popupBlockedCount.textContent = count;
});

// Tab DOM Helpers
function createTabElement(tab) {
  if (tabsMap.has(tab.id)) return;

  const tabEl = document.createElement('div');
  tabEl.className = 'tab';
  tabEl.id = `tab-${tab.id}`;

  const titleEl = document.createElement('span');
  titleEl.className = 'tab-title';
  titleEl.textContent = tab.title || 'Cargando...';

  const closeEl = document.createElement('span');
  closeEl.className = 'tab-close';
  closeEl.innerHTML = '&times;';
  closeEl.title = 'Cerrar pestaña';

  closeEl.addEventListener('click', (e) => {
    e.stopPropagation();
    window.starbishAPI.closeTab(tab.id);
  });

  tabEl.addEventListener('click', () => {
    window.starbishAPI.switchTab(tab.id);
  });

  tabEl.appendChild(titleEl);
  tabEl.appendChild(closeEl);
  tabsContainer.appendChild(tabEl);

  tabsMap.set(tab.id, { element: tabEl, titleEl });
}

function updateTabElement(tab) {
  let item = tabsMap.get(tab.id);
  if (!item) {
    createTabElement(tab);
    item = tabsMap.get(tab.id);
  }

  if (item && tab.title) {
    item.titleEl.textContent = tab.title;
  }

  if (tab.isActive) {
    currentActiveTabId = tab.id;
    // Highlight active tab
    tabsMap.forEach((val, id) => {
      val.element.classList.toggle('active', id === tab.id);
    });

    // Update Omnibox with current URL
    if (tab.url && !omnibox.matches(':focus')) {
      omnibox.value = tab.url.startsWith('https://www.bing.com') ? '' : tab.url;
    }

    // Update Back/Forward button states
    btnBack.disabled = !tab.canGoBack;
    btnForward.disabled = !tab.canGoForward;
  }
}

function removeTabElement(id) {
  const item = tabsMap.get(id);
  if (item && item.element) {
    item.element.remove();
  }
  tabsMap.delete(id);
}
