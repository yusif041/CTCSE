(() => {
  // Global State
  let firebaseReady = false;
  let db = null;
  let auth = null;
  
  let currentUser = null;
  let currentChannel = "general";
  let activeTab = "channels"; // "channels" or "dms"
  let activeDmUserId = null;
  
  let profiles = new Map();
  let localMessages = {
    "general": [],
    "announcements": [],
    "tech-lounge": []
  };
  
  // Moderation state
  let isAdmin = false;
  let bannedEmails = new Set();
  let mutedUsers = new Set();

  // Firestore Subscriptions
  let activeMessagesUnsubscribe = null;
  let userListUnsubscribe = null;
  let reportsUnsubscribe = null;
  let bansUnsubscribe = null;

  // DOM Helper
  const byId = id => document.getElementById(id);

  // Default Firebase Config
  const firebaseConfig = {
    apiKey: "AIzaSyDemoKeyForCTCSENetworkApp2026",
    authDomain: "ctcse-global-chat.firebaseapp.com",
    projectId: "ctcse-global-chat",
    storageBucket: "ctcse-global-chat.appspot.com",
    messagingSenderId: "102938475610",
    appId: "1:102938475610:web:abcdef1234567890"
  };

  // Avatar Generator Helper
  function avatarUrl(seed) {
    return `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(seed || "User")}`;
  }

  // Toast Notification System
  function showToast(message) {
    const toast = byId("comboToast");
    const msg = byId("comboToastMsg");
    if (toast && msg) {
      msg.textContent = message;
      toast.classList.remove("hidden");
      setTimeout(() => toast.classList.add("hidden"), 3000);
    }
  }

  // Sync / Connection Status UI Update
  function status(text, isLive = true) {
    const textEl = byId("syncStatusText");
    const dotEl = byId("syncStatusDot");
    if (textEl) textEl.textContent = text;
    if (dotEl) {
      dotEl.className = `w-2 h-2 rounded-full ${isLive ? "bg-emerald-400 animate-pulse" : "bg-amber-400"}`;
    }
  }

  // Initialize Firebase App
  function startFirebase() {
    try {
      if (typeof firebase !== 'undefined') {
        if (!firebase.apps.length) {
          firebase.initializeApp(firebaseConfig);
        }
        db = firebase.firestore();
        auth = firebase.auth();
        firebaseReady = true;

        // Enable offline persistence if available
        db.enablePersistence().catch(() => {});

        // Auth Listener
        auth.onAuthStateChanged(async (user) => {
          if (user) {
            currentUser = {
              uid: user.uid,
              email: user.email,
              username: user.displayName || user.email.split("@")[0]
            };

            // Fetch or Create user profile
            try {
              const userDocRef = db.collection("users").doc(user.uid);
              const doc = await userDocRef.get();
              if (!doc.exists) {
                await userDocRef.set({
                  username: currentUser.username,
                  email: currentUser.email.toLowerCase(),
                  createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });
              } else {
                currentUser.username = doc.data().username || currentUser.username;
              }
            } catch(e) {
              console.warn("Firestore user sync fallback");
            }

            setupUserUI();
            syncFromCloud();
            switchChannel("general");
          } else if (!currentUser) {
            byId("userModal")?.classList.remove("hidden");
            cleanupSubscriptions();
          }
        });
      } else {
        throw new Error("Firebase SDK not loaded");
      }
    } catch (err) {
      console.warn("Firebase Initialization Warning (Demo Mode Active):", err);
      firebaseReady = false;
      status("Demo / Offline Mode", false);
    }
  }

  function setupUserUI() {
    // Update UI Profile Card
    const avatar = byId("userAvatar");
    const name = byId("userDisplayName");
    const tag = byId("userTag");
    if (avatar) avatar.src = avatarUrl(currentUser.username);
    if (name) name.textContent = currentUser.username;
    if (tag) tag.textContent = `#${currentUser.uid.slice(-4)}`;

    // Hide Login Modal
    byId("userModal")?.classList.add("hidden");
  }

  // Clean up snapshot listeners on logout
  function cleanupSubscriptions() {
    if (activeMessagesUnsubscribe) activeMessagesUnsubscribe();
    if (userListUnsubscribe) userListUnsubscribe();
    if (reportsUnsubscribe) reportsUnsubscribe();
    if (bansUnsubscribe) bansUnsubscribe();
  }

  // Synchronize Cloud Firestore Data in Real-time
  function syncFromCloud() {
    if (!firebaseReady || !auth.currentUser) return;
    status("Live Syncing...", true);

    try {
      // 1. Listen for active Users in Database
      userListUnsubscribe = db.collection("users").onSnapshot(snapshot => {
        profiles = new Map(snapshot.docs.map(doc => [doc.id, { uid: doc.id, ...doc.data() }]));
        renderActiveUsersBoard();
        renderDmList();
      }, err => console.log("User sync offline mode"));

      // 2. Listen for Moderation Reports
      reportsUnsubscribe = db.collection("reports").onSnapshot(snapshot => {
        const count = snapshot.docs.length;
        const badge = byId("reportsBadgeCount");
        if (badge) badge.classList.toggle("hidden", count === 0);
        renderReportsList(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      }, err => {});

      // 3. SERVER BAN CHECK: Listen for real-time ban updates
      bansUnsubscribe = db.collection("bans").onSnapshot(snapshot => {
        bannedEmails = new Set(snapshot.docs.map(doc => doc.id.toLowerCase()));
        
        // INSTANT KICK: Check if current active user was banned
        if (currentUser && bannedEmails.has(currentUser.email.toLowerCase())) {
          alert("🚨 Your account has been permanently banned from this server.");
          signOut();
        }
      }, err => {});
    } catch(err) {
      console.warn("Live sync error, fallback active.");
    }
  }

  // Channel & Room Switching Logic
  function switchChannel(channelName) {
    activeTab = "channels";
    currentChannel = channelName;
    activeDmUserId = null;

    // Update Header Text & Icon
    const title = byId("channelTitle");
    const icon = byId("channelHeaderIcon");
    if (title) title.textContent = channelName;
    if (icon) {
      if (channelName === "announcements") icon.className = "fa-solid fa-bullhorn text-amber-400 text-lg";
      else if (channelName === "tech-lounge") icon.className = "fa-solid fa-code text-indigo-400 text-lg";
      else icon.className = "fa-solid fa-hashtag text-gray-400 text-lg";
    }

    // Toggle Channel Active Styling
    document.querySelectorAll(".channel-btn").forEach(btn => {
      btn.classList.remove("bg-[#404249]", "text-white");
      btn.classList.add("text-gray-400");
    });
    const activeBtn = byId(`chan-${channelName}`);
    if (activeBtn) {
      activeBtn.classList.add("bg-[#404249]", "text-white");
      activeBtn.classList.remove("text-gray-400");
    }

    listenToChannelMessages(`rooms/${channelName}/messages`);
  }

  // Subscribe to Realtime Messages
  function listenToChannelMessages(path) {
    if (activeMessagesUnsubscribe) activeMessagesUnsubscribe();

    const feed = byId("messagesFeed");
    if (feed) feed.replaceChildren();

    if (firebaseReady && auth && auth.currentUser) {
      activeMessagesUnsubscribe = db.collection(path)
        .orderBy("timestamp", "asc")
        .onSnapshot(snapshot => {
          if (!feed) return;
          feed.replaceChildren();

          snapshot.docs.forEach(doc => {
            const msg = doc.data();
            const msgId = doc.id;
            appendMessageUI(msgId, msg, path);
          });

          feed.scrollTop = feed.scrollHeight;
        }, err => {
          renderLocalFeed(path);
        });
    } else {
      renderLocalFeed(path);
    }
  }

  function renderLocalFeed(path) {
    const feed = byId("messagesFeed");
    if (!feed) return;
    feed.replaceChildren();
    
    const msgs = localMessages[currentChannel] || [];
    msgs.forEach((msg, index) => {
      appendMessageUI(`local-${index}`, msg, path);
    });
    feed.scrollTop = feed.scrollHeight;
  }

  // Render Individual Message Entry in Feed
  function appendMessageUI(msgId, msg, path) {
    const feed = byId("messagesFeed");
    if (!feed) return;

    const wrapper = document.createElement("div");
    wrapper.className = "flex space-x-3 p-2 rounded-lg hover:bg-[#2e3035] transition group message-enter relative";

    const isSystem = msg.authorId === "SYSTEM";
    const avatar = isSystem ? "https://api.dicebear.com/7.x/bottts/svg?seed=SYSTEM" : avatarUrl(msg.userName);
    const dateStr = msg.timestamp ? (msg.timestamp.toDate ? new Date(msg.timestamp.toDate()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "Just now") : "Just now";

    wrapper.innerHTML = `
      <img src="${avatar}" class="w-10 h-10 rounded-full bg-gray-700 object-cover shrink-0 mt-0.5">
      <div class="flex-1 min-w-0">
        <div class="flex items-center space-x-2">
          <span class="font-bold ${isSystem ? 'text-amber-400' : 'text-white'} text-sm truncate">${msg.userName}</span>
          <span class="text-[10px] text-gray-400">${dateStr}</span>
        </div>
        <p class="text-sm text-gray-200 mt-0.5 break-words select-text">${msg.text}</p>
      </div>
      <div class="opacity-0 group-hover:opacity-100 transition absolute right-2 top-2 flex items-center space-x-1 bg-[#1e1f22] p-1 rounded border border-gray-700 shadow">
        <button onclick="openReportModal('${msgId}', 'message')" class="text-xs text-gray-400 hover:text-rose-400 px-1.5 py-0.5 rounded" title="Report Message">
          <i class="fa-solid fa-flag"></i>
        </button>
        ${isAdmin ? `
          <button onclick="deleteMessage('${path}', '${msgId}')" class="text-xs text-rose-400 hover:text-rose-300 px-1.5 py-0.5 rounded" title="Delete Message (Admin)">
            <i class="fa-solid fa-trash"></i>
          </button>
        ` : ''}
      </div>
    `;

    feed.appendChild(wrapper);
  }

  // Send Message Handler
  async function handleSend(event) {
    event.preventDefault();
    const input = byId("chatInput");
    const text = input.value.trim();
    if (!text || !currentUser) return;

    // Server/Client Check: Prevent Muted Users from posting
    if (mutedUsers.has(currentUser.uid)) {
      showToast("🔇 You are currently muted by an administrator.");
      return;
    }

    const path = activeTab === "channels" 
      ? `rooms/${currentChannel}/messages`
      : `dms/${getDmRoomId(currentUser.uid, activeDmUserId)}/messages`;

    if (firebaseReady && auth && auth.currentUser) {
      try {
        await db.collection(path).add({
          authorId: currentUser.uid,
          userName: currentUser.username,
          text,
          timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
        input.value = "";
      } catch (err) {
        addLocalMessage(text);
        input.value = "";
      }
    } else {
      addLocalMessage(text);
      input.value = "";
    }
  }

  function addLocalMessage(text) {
    if (!localMessages[currentChannel]) localMessages[currentChannel] = [];
    localMessages[currentChannel].push({
      authorId: currentUser.uid,
      userName: currentUser.username,
      text,
      timestamp: null
    });
    listenToChannelMessages(`rooms/${currentChannel}/messages`);
  }

  // Deleting Message (Admin Command)
  async function deleteMessage(path, msgId) {
    if (!isAdmin) return;
    if (firebaseReady && !msgId.startsWith("local-")) {
      try {
        await db.collection(path).doc(msgId).delete();
        showToast("🗑️ Message deleted.");
      } catch (err) {
        showToast("Failed to delete message.");
      }
    } else {
      const idx = parseInt(msgId.replace("local-", ""));
      if (!isNaN(idx) && localMessages[currentChannel]) {
        localMessages[currentChannel].splice(idx, 1);
        listenToChannelMessages(path);
        showToast("🗑️ Message deleted.");
      }
    }
  }

  // PERMANENT BAN ADMIN LEVER
  async function banUserByEmail(email, reason = "Banned via Admin Lever Command") {
    if (!isAdmin) {
      showToast("🔒 Admin privileges required.");
      return;
    }
    const targetEmail = email.trim().toLowerCase();
    if (!targetEmail) {
      showToast("Please enter a valid email address.");
      return;
    }

    bannedEmails.add(targetEmail);

    if (firebaseReady) {
      try {
        await db.collection("bans").doc(targetEmail).set({
          bannedBy: currentUser.username,
          reason: reason,
          bannedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      } catch (err) {
        console.error("Ban cloud save error", err);
      }
    }

    showToast(`🔨 User (${targetEmail}) HAS BEEN PERMANENTLY BANNED.`);
    const input = byId("banTargetEmail");
    if (input) input.value = "";

    if (currentUser && currentUser.email.toLowerCase() === targetEmail) {
      alert("🚨 Your account has been permanently banned from this server.");
      signOut();
    }
  }

  // Lift Permanent Ban
  async function unbanUserByEmail(email) {
    if (!isAdmin) return;
    const targetEmail = email.trim().toLowerCase();
    bannedEmails.delete(targetEmail);
    if (firebaseReady) {
      try {
        await db.collection("bans").doc(targetEmail).delete();
      } catch(e) {}
    }
    showToast(`✅ Ban lifted for ${targetEmail}`);
  }

  // Mute / Unmute Toggle
  function toggleMuteUser(uid, username) {
    if (!isAdmin) return;
    if (mutedUsers.has(uid)) {
      mutedUsers.delete(uid);
      showToast(`🔊 Unmuted ${username || "user"}`);
    } else {
      mutedUsers.add(uid);
      showToast(`🔇 ${username || "User"} has been muted.`);
    }
    renderActiveUsersBoard();
  }

  // System Announcement Broadcast Lever
  async function broadcastSystemAnnouncement(message) {
    if (!isAdmin || !message.trim()) return;
    
    const sysMsg = {
      authorId: "SYSTEM",
      userName: "🚨 SYSTEM BROADCAST",
      text: message,
      timestamp: null
    };

    if (firebaseReady) {
      try {
        await db.collection("rooms/general/messages").add({
          ...sysMsg,
          timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
      } catch (err) {
        if (!localMessages["general"]) localMessages["general"] = [];
        localMessages["general"].push(sysMsg);
      }
    } else {
      if (!localMessages["general"]) localMessages["general"] = [];
      localMessages["general"].push(sysMsg);
    }

    showToast("📢 Announcement Broadcasted!");
    const input = byId("announceMsg");
    if (input) input.value = "";

    if (currentChannel === "general") {
      listenToChannelMessages("rooms/general/messages");
    }
  }

  // Toggle Admin Lever Panel Drawer
  function toggleLeverPanel() {
    const panel = byId("adminLeverPanel");
    if (panel) panel.classList.toggle("hidden");
  }

  // Render Community / Active Users Panel
  function renderActiveUsersBoard() {
    const container = byId("activeUsersList");
    if (!container) return;
    container.replaceChildren();

    // Database user list including registered accounts
    const activeList = profiles.size > 0 ? Array.from(profiles.values()) : [
      currentUser || { uid: "user_yusif", username: "yusifprogramming", email: "yusif@ctcse.edu" },
      { uid: "demo-user-2", username: "Alex Dev", email: "alex@ctcse.edu" },
      { uid: "demo-user-3", username: "Sarah_T", email: "sarah@ctcse.edu" }
    ];

    activeList.forEach(profile => {
      const row = document.createElement("div");
      row.className = "flex items-center justify-between p-1.5 rounded-lg hover:bg-[#35373c] transition group cursor-pointer";
      
      row.innerHTML = `
        <div class="flex items-center gap-2 min-w-0">
          <img src="${avatarUrl(profile.username)}" class="w-6 h-6 rounded-full bg-gray-700">
          <span class="text-xs text-gray-200 font-medium truncate">${profile.username}</span>
          ${mutedUsers.has(profile.uid) ? '<i class="fa-solid fa-microphone-slash text-[10px] text-amber-400"></i>' : ''}
        </div>
      `;

      // Quick Direct Message on Click
      row.onclick = (e) => {
        if (!e.target.closest('button')) {
          startDirectMessage(profile.uid, profile.username);
        }
      };

      // Quick Admin Controls Next to Profile
      if (isAdmin && profile.uid !== currentUser?.uid) {
        const actions = document.createElement("div");
        actions.className = "flex items-center gap-1 opacity-80 group-hover:opacity-100";

        const muteBtn = document.createElement("button");
        muteBtn.className = "text-[10px] bg-amber-500/20 text-amber-300 hover:bg-amber-500 hover:text-black px-1.5 py-0.5 rounded transition";
        muteBtn.textContent = mutedUsers.has(profile.uid) ? "Unmute" : "Mute";
        muteBtn.onclick = (e) => {
          e.stopPropagation();
          toggleMuteUser(profile.uid, profile.username);
        };

        const banBtn = document.createElement("button");
        banBtn.className = "text-[10px] bg-rose-500/20 text-rose-400 hover:bg-rose-600 hover:text-white px-1.5 py-0.5 rounded font-bold transition";
        banBtn.textContent = "BAN";
        banBtn.onclick = (e) => {
          e.stopPropagation();
          banUserByEmail(profile.email || `${profile.username.toLowerCase()}@ctcse.edu`, "Banned via User Board Action");
        };

        actions.append(muteBtn, banBtn);
        row.appendChild(actions);
      }

      container.appendChild(row);
    });
  }

  // Direct Messaging List Sync
  function renderDmList() {
    const list = byId("userDmList");
    if (!list) return;
    list.replaceChildren();

    const dmList = profiles.size > 0 ? Array.from(profiles.values()) : [
      { uid: "user_yusif", username: "yusifprogramming" },
      { uid: "demo-user-2", username: "Alex Dev" },
      { uid: "demo-user-3", username: "Sarah_T" }
    ];

    dmList.forEach(profile => {
      if (profile.uid === currentUser?.uid) return;

      const btn = document.createElement("button");
      btn.className = "w-full flex items-center space-x-2 px-2.5 py-1.5 rounded-lg text-gray-400 hover:bg-[#35373c] hover:text-gray-200 text-sm transition";
      btn.onclick = () => startDirectMessage(profile.uid, profile.username);
      btn.innerHTML = `
        <img src="${avatarUrl(profile.username)}" class="w-5 h-5 rounded-full bg-gray-700">
        <span class="truncate text-xs font-medium">${profile.username}</span>
      `;
      list.appendChild(btn);
    });
  }

  // REPORTING SYSTEM
  function openReportModal(targetId, type) {
    const modal = byId("reportModal");
    if (modal) {
      byId("reportTargetId").value = targetId;
      byId("reportTargetType").value = type;
      modal.classList.remove("hidden");
    }
  }

  function closeReportModal() {
    byId("reportModal")?.classList.add("hidden");
  }

  async function submitReport(e) {
    e.preventDefault();
    const targetId = byId("reportTargetId").value;
    const targetType = byId("reportTargetType").value;
    const reason = byId("reportReason").value;
    const details = byId("reportDetails").value;

    if (firebaseReady) {
      try {
        await db.collection("reports").add({
          reporterId: currentUser.uid,
          reporterName: currentUser.username,
          targetId,
          targetType,
          reason,
          details,
          timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
      } catch(e) {}
    }

    showToast("Report submitted to administrators.");
    closeReportModal();
  }

  function renderReportsList(reports) {
    const container = byId("reportsList");
    if (!container) return;
    container.replaceChildren();

    if (reports.length === 0) {
      container.innerHTML = `<div class="text-center text-gray-400 text-sm py-8">No pending moderation reports.</div>`;
      return;
    }

    reports.forEach(r => {
      const card = document.createElement("div");
      card.className = "p-3 bg-[#1e1f22] border border-gray-700 rounded-xl space-y-1 text-xs text-gray-200";
      card.innerHTML = `
        <div class="flex justify-between items-center text-amber-400 font-bold">
          <span>Reason: ${r.reason}</span>
          <span class="text-gray-400 text-[10px]">${r.targetType}</span>
        </div>
        <p class="text-gray-300">${r.details}</p>
        <div class="text-[10px] text-gray-500 pt-1">Reported by: ${r.reporterName}</div>
      `;
      container.appendChild(card);
    });
  }

  function openReportsPanel() {
    byId("adminReportsModal")?.classList.remove("hidden");
  }

  function closeReportsPanel() {
    byId("adminReportsModal")?.classList.add("hidden");
  }

  function toggleSecretGuide() {
    byId("secretGuideModal")?.classList.toggle("hidden");
  }

  function toggleUserBoard() {
    byId("userBoard")?.classList.toggle("hidden");
  }

  // Keyboard Shortcuts Listener for Secret Commands
  document.addEventListener("keydown", (e) => {
    // Ctrl + Shift + A -> Toggle Admin Mode
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "a") {
      e.preventDefault();
      toggleAdminMode();
    }
    // Ctrl + Shift + R -> Open Reports
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "r") {
      e.preventDefault();
      openReportsPanel();
    }
  });

  // Authentication Switch Mode Logic
  window.authMode = "login";
  window.switchAuthMode = () => {
    const isRegister = window.authMode === "login";
    window.authMode = isRegister ? "register" : "login";
    
    byId("modalTitle").textContent = isRegister ? "Create an Account" : "Welcome to CTCSE";
    byId("authDescription").textContent = isRegister ? "Enter your details below to get started." : "Sign in or create an account to join the global chat.";
    byId("usernameLabel").classList.toggle("hidden", !isRegister);
    byId("authSubmitButton").textContent = isRegister ? "Register" : "Sign In";
    byId("authSwitchButton").textContent = isRegister ? "Already have an account?" : "Create an account";
  };

  // Expose Functions Globally to HTML Event Handlers
  window.toggleAdminMode = toggleAdminMode;
  window.banUserByEmail = banUserByEmail;
  window.unbanUserByEmail = unbanUserByEmail;
  window.toggleLeverPanel = toggleLeverPanel;
  window.broadcastSystemAnnouncement = broadcastSystemAnnouncement;
  window.signOut = signOut;
  window.switchChannel = switchChannel;
  window.handleSend = handleSend;
  window.deleteMessage = deleteMessage;
  window.submitReport = submitReport;
  window.openReportModal = openReportModal;
  window.closeReportModal = closeReportModal;
  window.openReportsPanel = openReportsPanel;
  window.closeReportsPanel = closeReportsPanel;
  window.toggleSecretGuide = toggleSecretGuide;
  window.toggleUserBoard = toggleUserBoard;

  // Initialize Application
  startFirebase();
  renderActiveUsersBoard();
  renderDmList();
})();
