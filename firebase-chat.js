(() => {
  const firebaseConfig = {
    apiKey: "AIzaSyAHczDpNDtuyU50fHuJBibi7lzN45FUzxg",
    authDomain: "my-project-aedf1.firebaseapp.com",
    projectId: "my-project-aedf1",
    appId: "1:802524733061:web:c1eafe8716f708ef49d3ec"
  };

  const channelNames = ["general", "announcements", "tech-lounge"];
  const voiceChannelNames = ["General Voice", "Gaming Room"];

  let auth = null;
  let db = null;
  let firebaseReady = false;
  let authMode = "signin";
  let authFlowBusy = false;

  let activeMessagesUnsubscribe = null;
  let userListUnsubscribe = null;
  let voiceListUnsubscribe = null;
  let conversationsUnsubscribe = null;
  let bansUnsubscribe = null;
  let readObserver = null;

  let dmConversations = [];
  let profiles = new Map();
  let hiddenDms = new Set();
  let currentProfile = null;
  let voicePresence = [];
  let voiceHeartbeatTimer = null;

  // Voice Chat State
  window.activeVoiceChannel = null;
  let localStream = null;
  let peer = null;
  let peerConnections = {};
  let isMuted = false;
  let isDeafened = false;
  let audioAnalyser = null;
  let animFrame = null;

  // Global App State
  window.currentUser = { username: "", tag: "", uid: "", email: "" };
  window.currentChannel = "general";
  window.isAdmin = false;
  window.isUserMuted = false;

  const byId = id => document.getElementById(id);

  function status(message, connected = false) {
    const textEl = byId("syncStatusText");
    const dotEl = byId("syncStatusDot");
    const badgeEl = byId("syncBadge");
    if (!textEl || !dotEl || !badgeEl) return;
    textEl.textContent = message;
    dotEl.className = connected
      ? "w-2 h-2 rounded-full bg-emerald-400 animate-pulse"
      : "w-2 h-2 rounded-full bg-amber-300";
    badgeEl.className = connected
      ? "ml-3 text-xs bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded-full border border-emerald-500/20 flex items-center gap-1.5 font-medium"
      : "ml-3 text-xs bg-amber-500/10 text-amber-300 px-2 py-0.5 rounded-full border border-amber-500/20 flex items-center gap-1.5 font-medium";
  }

  function setAuthStatus(message, isError = false) {
    const element = byId("authStatus");
    if (!element) return;
    element.textContent = message;
    element.className = isError
      ? "text-sm text-rose-300 min-h-5"
      : "text-sm text-amber-300 min-h-5";
  }

  function showModal() {
    byId("userModal")?.classList.remove("hidden");
  }

  function hideModal() {
    byId("userModal")?.classList.add("hidden");
  }

  function configureAuthForm(mode, message = "") {
    authMode = mode;
    const signedIn = Boolean(auth && auth.currentUser);
    const profileMode = mode === "profile";
    const passwordMode = mode === "set-password";
    const settingsMode = mode === "settings";
    const hideCredentials = profileMode || passwordMode || settingsMode;

    const modalTitle = byId("modalTitle");
    const authDescription = byId("authDescription");
    const emailField = byId("emailField");
    const username = byId("modalUsername");
    const email = byId("modalEmail");
    const password = byId("modalPassword");
    const authSubmitButton = byId("authSubmitButton");

    if (email && !signedIn) email.value = "";
    if (password && !signedIn) password.value = "";
    if (username) username.value = "";

    if (modalTitle) {
      modalTitle.textContent = profileMode
        ? "Choose your username"
        : passwordMode
          ? "Set a password"
          : settingsMode
            ? "Account settings"
            : mode === "register"
              ? "Create your account"
              : "Welcome to CTCSE";
    }

    if (authDescription) {
      authDescription.textContent = profileMode
        ? "This username will identify you in chats."
        : passwordMode
          ? "Set a password to sign in with email and password next time."
          : settingsMode
            ? `Signed in as ${auth?.currentUser?.email || "Google Account"}.`
            : mode === "register"
              ? "Create a new account. Your email is your sign-in ID."
              : "Sign in or create an account to join the global chat.";
    }

    if (emailField) emailField.classList.toggle("hidden", hideCredentials);
    if (email) {
      email.required = !hideCredentials;
      email.disabled = hideCredentials;
    }
    if (username) {
      username.classList.toggle("hidden", !profileMode);
      username.required = profileMode;
      username.disabled = !profileMode;
    }
    byId("usernameLabel")?.classList.toggle("hidden", !profileMode);

    if (password) {
      password.required = mode === "signin" || mode === "register" || passwordMode;
      password.disabled = settingsMode || profileMode;
      password.autocomplete = mode === "signin" ? "current-password" : "new-password";
    }
    byId("passwordField")?.classList.toggle("hidden", settingsMode || profileMode);
    
    const passwordLabel = byId("passwordLabel");
    if (passwordLabel) passwordLabel.textContent = passwordMode ? "New password" : "Password";

    byId("authActions")?.classList.toggle("hidden", false);
    if (authSubmitButton) {
      authSubmitButton.classList.toggle("hidden", settingsMode);
      authSubmitButton.textContent = profileMode
        ? "Continue"
        : passwordMode
          ? "Save password"
          : mode === "register"
            ? "Create account"
            : "Sign in";
    }

    byId("authSwitchButton")?.classList.toggle("hidden", profileMode || passwordMode || settingsMode);
    byId("googleAuthButton")?.classList.toggle("hidden", profileMode || passwordMode || settingsMode);
    byId("resetPasswordButton")?.classList.toggle("hidden", mode !== "signin" && !settingsMode);
    byId("modalCloseBtn")?.classList.toggle("hidden", !signedIn || profileMode || passwordMode);
    setAuthStatus(message);
  }

  function firebaseIsConfigured() {
    return ["apiKey", "authDomain", "projectId", "appId"]
      .every(key => typeof firebaseConfig[key] === "string" && firebaseConfig[key].trim() !== "");
  }

  function startFirebase() {
    if (!window.firebase || !firebaseIsConfigured()) {
      status("Setup required");
      showModal();
      return;
    }

    try {
      firebase.initializeApp(firebaseConfig);
      auth = firebase.auth();
      db = firebase.firestore();
      firebaseReady = true;

      auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL)
        .then(() => auth.onAuthStateChanged(handleAuthChanged))
        .catch(error => {
          console.error("Firebase auth error:", error);
          status("Auth error");
          showModal();
        });
    } catch (error) {
      console.error("Firebase init failed:", error);
      status("Connection error");
      showModal();
    }
  }

  async function checkIsBanned(email) {
    if (!db || !email) return false;
    try {
      const doc = await db.collection("banned").doc(email.toLowerCase()).get();
      return doc.exists;
    } catch (err) {
      return false;
    }
  }

  async function handleAuthChanged(user) {
    if (authFlowBusy) return;
    if (!user) {
      clearSubscriptions();
      currentProfile = null;
      window.currentUser = { username: "", tag: "", uid: "", email: "" };
      profiles = new Map();
      dmConversations = [];
      voicePresence = [];
      status("Signed out");
      configureAuthForm("signin");
      showModal();
      return;
    }

    const banned = await checkIsBanned(user.email);
    if (banned) {
      await auth.signOut();
      alert(`Account (${user.email}) has been permanently banned.`);
      location.reload();
      return;
    }

    await finishSignIn(user);
  }

  async function finishSignIn(user) {
    try {
      const userSnapshot = await db.collection("users").doc(user.uid).get();
      if (!userSnapshot.exists) {
        configureAuthForm("profile", "Choose a username to finish setting up your account.");
        showModal();
        return;
      }
      currentProfile = userSnapshot.data();
      enterChat(user, currentProfile);
    } catch (error) {
      console.error("Unable to load profile", error);
      configureAuthForm("signin", "Could not load profile. Please try again.");
      showModal();
    }
  }

  function enterChat(user, profile) {
    currentProfile = profile;
    window.currentUser = {
      username: profile.username,
      uid: user.uid,
      tag: "#" + user.uid.slice(0, 4).toUpperCase(),
      email: user.email || ""
    };

    const userDisplayName = byId("userDisplayName");
    const userTag = byId("userTag");
    const userAvatar = byId("userAvatar");

    if (userDisplayName) userDisplayName.textContent = profile.username;
    if (userTag) userTag.textContent = window.currentUser.tag;
    if (userAvatar) userAvatar.src = avatarUrl(profile.username);

    hideModal();
    hiddenDms = loadHiddenDms();
    syncFromCloud();
    switchChannel(channelNames.includes(window.currentChannel) ? window.currentChannel : "general");
  }

  function avatarUrl(name) {
    return `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(name)}`;
  }

  function validUsername(value) {
    return /^[a-zA-Z0-9_]{3,20}$/.test(value);
  }

  async function createProfile(user, username) {
    if (!validUsername(username)) {
      throw new Error("Username must be 3–20 characters and contain only letters, numbers, or underscores.");
    }
    const usernameLower = username.toLowerCase();
    const usernameRef = db.collection("usernames").doc(usernameLower);
    const userRef = db.collection("users").doc(user.uid);
    const profile = {
      username,
      usernameLower,
      email: user.email || "",
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    await db.runTransaction(async transaction => {
      const [usernameSnapshot, userSnapshot] = await Promise.all([
        transaction.get(usernameRef),
        transaction.get(userRef)
      ]);
      if (usernameSnapshot.exists && usernameSnapshot.data().uid !== user.uid) {
        throw new Error("That username is already taken. Please choose another.");
      }
      transaction.set(usernameRef, { uid: user.uid, username });
      transaction.set(userRef, profile);
    });
    return profile;
  }

  async function submitAuth(event) {
    if (event) event.preventDefault();
    if (!firebaseReady) return;

    const emailInput = byId("modalEmail");
    const passwordInput = byId("modalPassword");
    const email = emailInput ? emailInput.value.trim().toLowerCase() : "";
    const password = passwordInput ? passwordInput.value : "";

    setAuthStatus("Processing...");

    try {
      if (authMode === "register") {
        const username = byId("modalUsername").value.trim();
        if (!validUsername(username)) throw new Error("Invalid username format.");
        if (password.length < 8) throw new Error("Password must be at least 8 characters.");

        authFlowBusy = true;
        const credential = await auth.createUserWithEmailAndPassword(email, password);
        try {
          const profile = await createProfile(credential.user, username);
          enterChat(credential.user, profile);
        } catch (err) {
          await credential.user.delete();
          throw err;
        }
      } else if (authMode === "profile") {
        const username = byId("modalUsername").value.trim();
        const profile = await createProfile(auth.currentUser, username);
        currentProfile = profile;
        enterChat(auth.currentUser, profile);
      } else {
        authFlowBusy = true;
        const credential = await auth.signInWithEmailAndPassword(email, password);
        await finishSignIn(credential.user);
      }
    } catch (error) {
      console.error("Auth submit error:", error);
      setAuthStatus(error.message || "Sign-in failed.", true);
    } finally {
      authFlowBusy = false;
    }
  }

  async function signInWithGoogle() {
    if (!firebaseReady) return;
    setAuthStatus("Connecting Google Sign-In...");
    try {
      authFlowBusy = true;
      const provider = new firebase.auth.GoogleAuthProvider();
      const result = await auth.signInWithPopup(provider);
      await finishSignIn(result.user);
    } catch (error) {
      console.error("Google sign-in error:", error);
      setAuthStatus(error.message || "Google sign-in failed.", true);
    } finally {
      authFlowBusy = false;
    }
  }

  function openSettings() {
    if (!auth || !auth.currentUser) {
      configureAuthForm("signin");
      showModal();
      return;
    }
    configureAuthForm("settings");
    showModal();
  }

  function closeSettings() {
    if (auth && auth.currentUser && currentProfile) hideModal();
  }

  async function signOut() {
    if (!auth || !auth.currentUser) return;
    try {
      if (window.activeVoiceChannel) {
        await updateVoiceParticipantsCloud(false);
        leaveVoiceChannel();
      }
      await auth.signOut();
    } catch (error) {
      console.error("Sign-out error:", error);
    }
  }

  function clearSubscriptions() {
    [activeMessagesUnsubscribe, userListUnsubscribe, voiceListUnsubscribe, conversationsUnsubscribe, bansUnsubscribe]
      .forEach(unsub => { if (unsub) unsub(); });
    activeMessagesUnsubscribe = null;
    userListUnsubscribe = null;
    voiceListUnsubscribe = null;
    conversationsUnsubscribe = null;
    bansUnsubscribe = null;
    if (readObserver) readObserver.disconnect();
    readObserver = null;
    if (voiceHeartbeatTimer) clearInterval(voiceHeartbeatTimer);
    voiceHeartbeatTimer = null;
  }

  function syncFromCloud() {
    if (!firebaseReady || !auth.currentUser) return;
    clearSubscriptions();
    status("Connecting...");

    bansUnsubscribe = db.collection("banned").doc(auth.currentUser.email.toLowerCase()).onSnapshot(snapshot => {
      if (snapshot.exists) {
        alert("Your account has been banned by an administrator.");
        signOut();
        location.reload();
      }
    });

    userListUnsubscribe = db.collection("users").onSnapshot(snapshot => {
      profiles = new Map(snapshot.docs.map(doc => [doc.id, { uid: doc.id, ...doc.data() }]));
      renderActiveUsersBoard();
      renderUserDmList();
      status("Live", true);
    }, error => console.error("User list error:", error));

    conversationsUnsubscribe = db.collection("directMessages")
      .where("participants", "array-contains", auth.currentUser.uid)
      .onSnapshot(async snapshot => {
        try {
          const entries = await Promise.all(snapshot.docs.map(async doc => {
            const otherUid = doc.data().participants.find(u => u !== auth.currentUser.uid);
            if (!otherUid) return null;
            let profile = profiles.get(otherUid);
            if (!profile) {
              const snap = await db.collection("users").doc(otherUid).get();
              if (!snap.exists) return null;
              profile = { uid: otherUid, ...snap.data() };
              profiles.set(otherUid, profile);
            }
            return { id: doc.id, uid: otherUid, username: profile.username };
          }));
          dmConversations = entries.filter(Boolean);
          renderUserDmList();
        } catch (err) {
          console.error("DM sync error:", err);
        }
      });

    voiceListUnsubscribe = db.collection("voicePresence").onSnapshot(snapshot => {
      const activeSince = Date.now() - 60000;
      voicePresence = snapshot.docs
        .map(doc => ({ uid: doc.id, ...doc.data() }))
        .filter(item => item.updatedAt && item.updatedAt.toDate().getTime() >= activeSince);
      
      updateVoiceChannelCounts();
      if (window.activeVoiceChannel) renderVoiceStage();
    }, error => console.error("Voice presence error:", error));
  }

  function roomKey(channel) {
    if (!channel.startsWith("@")) return channel;
    const otherUid = channel.slice(1);
    return "dm_" + [auth.currentUser.uid, otherUid].sort().join("_");
  }

  function dmDocumentId(uidA, uidB) {
    return [uidA, uidB].sort().join("_");
  }

  function getMessageCollection(channel) {
    if (channel.startsWith("@")) {
      return db.collection("directMessages")
        .doc(dmDocumentId(auth.currentUser.uid, channel.slice(1)))
        .collection("messages");
    }
    return db.collection("rooms").doc(channel).collection("messages");
  }

  function switchChannel(channel) {
    if (!auth || !auth.currentUser) return;
    window.currentChannel = channel;
    const isDm = channel.startsWith("@");
    const target = isDm ? profiles.get(channel.slice(1)) : null;

    const titleEl = byId("channelTitle");
    if (titleEl) titleEl.textContent = isDm ? `@${target?.username || 'User'}` : channel;

    document.querySelectorAll(".channel-btn, #userDmList > div").forEach(btn => {
      btn.classList.remove("bg-[#404249]", "text-white");
      btn.classList.add("text-gray-400");
    });
    const activeButton = byId(`chan-${channel}`);
    if (activeButton) {
      activeButton.classList.add("bg-[#404249]", "text-white");
      activeButton.classList.remove("text-gray-400");
    }

    const chatInput = byId("chatInput");
    if (chatInput) chatInput.placeholder = `Message ${isDm ? "@" + (target?.username || "") : "#" + channel}...`;

    if (activeMessagesUnsubscribe) activeMessagesUnsubscribe();

    const feed = byId("messagesFeed");
    if (!feed) return;
    feed.replaceChildren();

    activeMessagesUnsubscribe = getMessageCollection(channel)
      .orderBy("timestamp", "asc")
      .limit(200)
      .onSnapshot(snapshot => {
        const messages = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderFeed(messages);
      }, err => console.error("Feed snapshot error:", err));
  }

  function renderFeed(messages = []) {
    const feed = byId("messagesFeed");
    if (!feed) return;

    const shouldStickToBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 80;
    if (readObserver) readObserver.disconnect();
    const observedChannel = window.currentChannel;

    readObserver = "IntersectionObserver" in window
      ? new IntersectionObserver(entries => {
          entries.forEach(entry => {
            if (entry.isIntersecting) markMessageSeen(entry.target.dataset.messageId, observedChannel);
          });
        }, { root: feed, threshold: 0.5 })
      : null;

    feed.replaceChildren();

    const heading = document.createElement("div");
    heading.className = "mb-4";
    heading.innerHTML = `<h1 class="text-2xl font-bold text-white">Welcome to ${
      window.currentChannel.startsWith("@")
        ? "@" + (profiles.get(window.currentChannel.slice(1))?.username || "chat")
        : "#" + window.currentChannel
    }!</h1>`;
    feed.appendChild(heading);

    messages.forEach(msg => {
      const article = document.createElement("article");
      article.className = "group relative flex items-start gap-3 hover:bg-[#2e3035] -mx-4 px-4 py-2 rounded";
      article.dataset.messageId = msg.id;
      
      const avatar = document.createElement("img");
      avatar.src = avatarUrl(msg.userName || "User");
      avatar.className = "w-10 h-10 rounded-full bg-gray-700 shrink-0";

      const content = document.createElement("div");
      content.className = "min-w-0 flex-1";

      const meta = document.createElement("div");
      meta.className = "flex items-baseline gap-2";
      meta.innerHTML = `<span class="font-semibold text-white text-sm">${msg.userName || "User"}</span>
        <span class="text-xs text-gray-400">${new Date(msg.timestamp?.toDate ? msg.timestamp.toDate() : msg.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>`;

      const text = document.createElement("p");
      text.className = "text-gray-300 text-sm break-words whitespace-pre-wrap";
      text.textContent = msg.text || "";

      // Who saw this? / Read receipts UI
      const actions = document.createElement("div");
      actions.className = "mt-1 flex items-center gap-2";

      const seenButton = document.createElement("button");
      seenButton.type = "button";
      seenButton.className = "text-[11px] text-gray-400 hover:text-indigo-300 transition";
      seenButton.innerHTML = '<i class="fa-regular fa-eye mr-1"></i>Who saw this?';

      const readers = document.createElement("span");
      readers.className = "hidden text-[11px] text-gray-400";
      readers.setAttribute("aria-live", "polite");

      seenButton.addEventListener("click", async () => {
        readers.classList.toggle("hidden");
        if (!readers.classList.contains("hidden")) {
          readers.textContent = await getReaderNames(msg.id, observedChannel);
        }
      });

      actions.append(seenButton);

      if (msg.authorId === auth.currentUser.uid || window.isAdmin) {
        const removeButton = document.createElement("button");
        removeButton.className = "text-gray-500 hover:text-rose-400 text-xs transition";
        removeButton.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
        removeButton.onclick = () => getMessageCollection(window.currentChannel).doc(msg.id).delete();
        actions.appendChild(removeButton);
      }

      actions.appendChild(readers);
      content.append(meta, text, actions);
      article.append(avatar, content);

      feed.appendChild(article);

      if (readObserver && msg.authorId !== auth.currentUser.uid) {
        readObserver.observe(article);
      } else if (!readObserver && msg.authorId !== auth.currentUser.uid) {
        markMessageSeen(msg.id, observedChannel);
      }
    });

    if (shouldStickToBottom) feed.scrollTop = feed.scrollHeight;
  }

  async function getReaderNames(messageId, channel) {
    try {
      const receipts = await getMessageCollection(channel).doc(messageId).collection("readers").get();
      const names = await Promise.all(receipts.docs.map(async receipt => {
        const uid = receipt.id;
        const profile = profiles.get(uid);
        if (profile) return profile.username;
        const snapshot = await db.collection("users").doc(uid).get();
        if (!snapshot.exists) return "Former user";
        const data = snapshot.data();
        profiles.set(uid, { uid, ...data });
        return data.username || "User";
      }));
      return names.length ? `Seen by: ${names.join(", ")}` : "Not seen yet.";
    } catch (error) {
      console.error("Unable to load readers", error);
      return "Could not load readers.";
    }
  }

  async function markMessageSeen(messageId, channel) {
    if (!auth || !auth.currentUser || !channel) return;
    try {
      const receipt = getMessageCollection(channel).doc(messageId)
        .collection("readers").doc(auth.currentUser.uid);
      if (!(await receipt.get()).exists) {
        await receipt.set({ readAt: firebase.firestore.FieldValue.serverTimestamp() });
      }
    } catch (error) {
      if (error.code !== "permission-denied") console.error("Read receipt error:", error);
    }
  }

  async function handleSend(event) {
    if (event) event.preventDefault();
    if (!auth || !auth.currentUser) return;
    const input = byId("chatInput");
    const text = input ? input.value.trim() : "";
    if (!text) return;

    if (window.isUserMuted) {
      alert("You are currently muted by an administrator.");
      return;
    }

    try {
      const message = {
        authorId: auth.currentUser.uid,
        userName: currentProfile.username,
        text,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
      };
      await getMessageCollection(window.currentChannel).add(message);
      if (input) input.value = "";
    } catch (error) {
      console.error("Failed to send message:", error);
    }
  }

  // --- Voice Channel Logic ---

  async function joinVoiceChannel(channelName) {
    if (window.activeVoiceChannel === channelName) return;
    if (window.activeVoiceChannel) leaveVoiceChannel();

    window.activeVoiceChannel = channelName;
    byId("voiceConnectionBar")?.classList.remove("hidden");
    const channelNameEl = byId("activeVoiceChannelName");
    if (channelNameEl) channelNameEl.innerText = channelName;
    byId("voiceStage")?.classList.remove("hidden");

    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (err) {
      console.warn("Microphone access unavailable or denied.", err);
      localStream = new MediaStream();
    }

    setupSpeakingDetection();

    const peerId = "ctcse_" + window.currentUser.username.replace(/[^a-zA-Z0-9]/g, "");
    peer = new window.Peer(peerId);

    peer.on('open', (id) => {
      const peerStatusEl = byId("peerStatus");
      if (peerStatusEl) peerStatusEl.innerText = "Voice Connected (" + id.substring(6) + ")";
      updateVoiceParticipantsCloud(true);
    });

    peer.on('call', (call) => {
      call.answer(localStream);
      call.on('stream', (remoteStream) => {
        attachRemoteStream(call.peer, remoteStream);
      });
      peerConnections[call.peer] = call;
    });

    peer.on('error', (err) => {
      console.error("PeerJS Error:", err);
    });

    renderVoiceStage();
  }

  function setupSpeakingDetection() {
    if (!localStream || localStream.getAudioTracks().length === 0) return;
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(localStream);
      audioAnalyser = audioCtx.createAnalyser();
      audioAnalyser.fftSize = 512;
      source.connect(audioAnalyser);

      const dataArray = new Uint8Array(audioAnalyser.frequencyBinCount);

      function checkVolume() {
        if (!window.activeVoiceChannel) return;
        audioAnalyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
        let average = sum / dataArray.length;

        const myAvatar = byId("avatar-voice-" + window.currentUser.username);
        if (myAvatar) {
          if (average > 15 && !isMuted) {
            myAvatar.classList.add("speaking-glow");
          } else {
            myAvatar.classList.remove("speaking-glow");
          }
        }
        animFrame = requestAnimationFrame(checkVolume);
      }
      checkVolume();
    } catch (e) {
      console.error("Audio detection error:", e);
    }
  }

  function attachRemoteStream(peerId, stream) {
    let audioEl = byId("audio-peer-" + peerId);
    if (!audioEl) {
      audioEl = document.createElement("audio");
      audioEl.id = "audio-peer-" + peerId;
      audioEl.autoplay = true;
      byId("remoteAudioContainer")?.appendChild(audioEl);
    }
    audioEl.srcObject = stream;
    audioEl.muted = isDeafened;
  }

  function toggleMute() {
    isMuted = !isMuted;
    const btn = byId("micToggleBtn");
    const icon = byId("micIcon");

    if (localStream && localStream.getAudioTracks().length > 0) {
      localStream.getAudioTracks()[0].enabled = !isMuted;
    }

    if (btn && icon) {
      if (isMuted) {
        btn.classList.add("text-red-400", "bg-red-500/10");
        icon.className = "fa-solid fa-microphone-slash";
      } else {
        btn.classList.remove("text-red-400", "bg-red-500/10");
        icon.className = "fa-solid fa-microphone";
      }
    }
    renderVoiceStage();
  }

  function toggleDeafen() {
    isDeafened = !isDeafened;
    const btn = byId("deafenToggleBtn");
    const icon = byId("deafenIcon");

    const remoteAudios = document.querySelectorAll("#remoteAudioContainer audio");
    remoteAudios.forEach(aud => aud.muted = isDeafened);

    if (btn && icon) {
      if (isDeafened) {
        btn.classList.add("text-red-400", "bg-red-500/10");
        icon.className = "fa-solid fa-ear-deafen";
      } else {
        btn.classList.remove("text-red-400", "bg-red-500/10");
        icon.className = "fa-solid fa-headphones";
      }
    }
    renderVoiceStage();
  }

  function leaveVoiceChannel() {
    if (!window.activeVoiceChannel) return;

    updateVoiceParticipantsCloud(false);

    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
    }

    if (peer) {
      peer.destroy();
      peer = null;
    }

    if (animFrame) cancelAnimationFrame(animFrame);

    peerConnections = {};
    const remoteContainer = byId("remoteAudioContainer");
    if (remoteContainer) remoteContainer.innerHTML = "";

    window.activeVoiceChannel = null;
    byId("voiceConnectionBar")?.classList.add("hidden");
    byId("voiceStage")?.classList.add("hidden");
  }

  function renderVoiceStage() {
    if (!window.activeVoiceChannel) return;
    const grid = byId("voiceGrid");
    if (!grid) return;
    grid.innerHTML = "";

    let channelPeers = voicePresence.filter(p => p.channel === window.activeVoiceChannel);

    if (!channelPeers.find(p => p.username === window.currentUser.username)) {
      channelPeers.push({
        username: window.currentUser.username,
        channel: window.activeVoiceChannel
      });
    }

    channelPeers.forEach(p => {
      if (p.username !== window.currentUser.username && peer && !peerConnections["ctcse_" + p.username.replace(/[^a-zA-Z0-9]/g, "")]) {
        const targetPeerId = "ctcse_" + p.username.replace(/[^a-zA-Z0-9]/g, "");
        const call = peer.call(targetPeerId, localStream);
        if (call) {
          call.on('stream', (remoteStream) => {
            attachRemoteStream(targetPeerId, remoteStream);
          });
          peerConnections[targetPeerId] = call;
        }
      }

      const card = document.createElement("div");
      card.className = "bg-[#2b2d31] border border-[#1e1f22] rounded-xl p-3 flex flex-col items-center justify-center space-y-2 relative shadow";

      const isMe = p.username === window.currentUser.username;

      card.innerHTML = `
        <div class="relative">
          <img id="avatar-voice-${p.username}" src="${avatarUrl(p.username)}" class="w-14 h-14 rounded-full bg-gray-700 transition-all duration-150">
          ${isMe && isMuted ? `
            <div class="absolute bottom-0 right-0 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-[10px]">
              <i class="fa-solid fa-microphone-slash"></i>
            </div>
          ` : ''}
        </div>
        <span class="text-xs font-semibold text-white truncate max-w-full">${p.username} ${isMe ? '(You)' : ''}</span>
      `;
      grid.appendChild(card);
    });
  }

  async function updateVoiceParticipantsCloud(isJoining) {
    if (!firebaseReady || !auth.currentUser) return;
    const presenceRef = db.collection("voicePresence").doc(auth.currentUser.uid);
    try {
      if (!isJoining || !window.activeVoiceChannel) {
        if (voiceHeartbeatTimer) clearInterval(voiceHeartbeatTimer);
        voiceHeartbeatTimer = null;
        await presenceRef.delete();
      } else {
        const updatePresence = () => presenceRef.set({
          username: currentProfile.username,
          channel: window.activeVoiceChannel,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        await updatePresence();
        if (!voiceHeartbeatTimer) voiceHeartbeatTimer = setInterval(updatePresence, 20000);
      }
    } catch (error) {
      console.error("Voice presence sync error:", error);
    }
  }

  function updateVoiceChannelCounts() {
    const counts = {};
    voicePresence.forEach(p => {
      counts[p.channel] = (counts[p.channel] || 0) + 1;
    });

    voiceChannelNames.forEach(chan => {
      const countEl = byId(`voice-count-${chan.replace(/\s+/g, '-')}`);
      if (countEl) {
        const c = counts[chan] || 0;
        countEl.innerText = c > 0 ? `${c} connected` : '';
      }
    });
  }

  // --- Direct Messaging & User Search ---

  async function addUserByUsername(event) {
    if (event) event.preventDefault();
    const input = byId("addUsernameInput");
    const username = input ? input.value.trim() : "";
    if (!username) return;

    try {
      const usernameDoc = await db.collection("usernames").doc(username.toLowerCase()).get();
      if (!usernameDoc.exists) {
        alert("Account not found.");
        return;
      }
      const targetUid = usernameDoc.data().uid;
      if (targetUid === auth.currentUser.uid) {
        alert("You cannot add yourself.");
        return;
      }
      await openDirectMessage(targetUid);
      if (input) input.value = "";
    } catch (error) {
      console.error("Search account error:", error);
    }
  }

  async function openDirectMessage(targetUid) {
    const targetSnapshot = await db.collection("users").doc(targetUid).get();
    if (!targetSnapshot.exists) return;

    const conversationId = dmDocumentId(auth.currentUser.uid, targetUid);
    const conversationRef = db.collection("directMessages").doc(conversationId);
    const conversation = await conversationRef.get();

    if (!conversation.exists) {
      await conversationRef.set({
        participants: [auth.currentUser.uid, targetUid].sort(),
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    }

    const profile = { uid: targetUid, ...targetSnapshot.data() };
    profiles.set(targetUid, profile);
    if (!dmConversations.some(item => item.uid === targetUid)) {
      dmConversations.push({ id: conversationId, uid: targetUid, username: profile.username });
      renderUserDmList();
    }
    switchChannel("@" + targetUid);
  }

  function renderUserDmList() {
    const container = byId("userDmList");
    if (!container) return;
    container.replaceChildren();

    dmConversations.filter(item => !hiddenDms.has(item.id)).forEach(item => {
      const row = document.createElement("div");
      row.id = `chan-@${item.uid}`;
      row.className = "group relative flex items-center justify-between px-2 py-1.5 rounded hover:bg-[#35373c] text-gray-400 hover:text-gray-200 cursor-pointer text-sm font-medium";

      const openBtn = document.createElement("button");
      openBtn.className = "flex items-center gap-2 truncate flex-1 text-left";
      openBtn.onclick = () => switchChannel("@" + item.uid);
      openBtn.innerHTML = `<i class="fa-solid fa-at text-xs text-gray-400"></i><span class="truncate">${item.username}</span>`;

      row.append(openBtn);
      container.appendChild(row);
    });
  }

  function renderActiveUsersBoard() {
    const container = byId("activeUsersList");
    if (!container) return;
    container.replaceChildren();

    [...profiles.values()].sort((a, b) => a.username.localeCompare(b.username)).forEach(profile => {
      const row = document.createElement("div");
      row.className = "flex items-center justify-between p-1.5 hover:bg-[#35373c] rounded w-full text-left transition text-sm font-medium text-gray-200";

      const userBtn = document.createElement("button");
      userBtn.className = "flex items-center gap-2 truncate flex-1";
      userBtn.innerHTML = `<img src="${avatarUrl(profile.username)}" class="w-7 h-7 rounded-full bg-gray-700">
        <span class="truncate">${profile.username}${profile.uid === auth.currentUser?.uid ? " (You)" : ""}</span>`;

      if (profile.uid !== auth.currentUser?.uid) {
        userBtn.onclick = () => openDirectMessage(profile.uid);
      }

      row.appendChild(userBtn);

      // Admin Action Buttons (Ban & Delete from database)
      if (window.isAdmin && profile.uid !== auth.currentUser?.uid) {
        const adminActions = document.createElement("div");
        adminActions.className = "flex items-center gap-1 shrink-0 ml-1";

        const banBtn = document.createElement("button");
        banBtn.className = "text-xs bg-rose-500/20 text-rose-300 hover:bg-rose-500 hover:text-white px-1.5 py-0.5 rounded transition";
        banBtn.title = "Permanently Ban User & Move to Banned database";
        banBtn.innerHTML = '<i class="fa-solid fa-gavel"></i>';
        banBtn.onclick = (e) => {
          e.stopPropagation();
          adminBanUser(profile.uid, profile.email || profile.username);
        };

        adminActions.appendChild(banBtn);
        row.appendChild(adminActions);
      }

      container.appendChild(row);
    });
  }

  // --- Secret Admin Passcode Logic (1414) ---
  let passcodeDigits = [0, 0, 0, 0];

  window.incrementDigit = function(index) {
    passcodeDigits[index] = (passcodeDigits[index] + 1) % 10;
    const btn = byId(`digit-${index}`);
    if (btn) btn.textContent = passcodeDigits[index];
  };

  window.submitPasscode = function() {
    const code = passcodeDigits.join("");
    if (code === "1414") {
      window.isAdmin = true;
      alert("Admin Powers Unlocked!");
      byId("adminBadge")?.classList.remove("hidden");
      renderActiveUsersBoard();
    } else {
      alert("Invalid Admin Passcode.");
      passcodeDigits = [0, 0, 0, 0];
      [0, 1, 2, 3].forEach(i => {
        const btn = byId(`digit-${i}`);
        if (btn) btn.textContent = "0";
      });
    }
  };

  window.adminBanUser = async function(targetUid, identifier) {
    if (!window.isAdmin) return;
    const targetEmail = identifier || prompt("Enter email address to ban:");
    if (!targetEmail) return;

    try {
      // 1. Add email to 'banned' collection
      await db.collection("banned").doc(targetEmail.toLowerCase()).set({
        bannedAt: firebase.firestore.FieldValue.serverTimestamp(),
        bannedBy: window.currentUser.email
      });

      // 2. Delete user profile from 'users' collection
      if (targetUid) {
        await db.collection("users").doc(targetUid).delete();
      }

      alert(`User ${targetEmail} banned permanently and removed from database.`);
    } catch (err) {
      console.error("Ban error:", err);
      alert("Failed to ban user.");
    }
  };

  function loadHiddenDms() {
    try {
      return new Set(JSON.parse(localStorage.getItem(`hidden_dms_${auth?.currentUser?.uid}`) || "[]"));
    } catch (e) { return new Set(); }
  }

  // Bind Global Exports
  window.submitAuth = submitAuth;
  window.signInWithGoogle = signInWithGoogle;
  window.openSettings = openSettings;
  window.closeSettings = closeSettings;
  window.signOut = signOut;
  window.switchChannel = switchChannel;
  window.handleSend = handleSend;
  window.addUserByUsername = addUserByUsername;
  window.renderUserDmList = renderUserDmList;
  window.joinVoiceChannel = joinVoiceChannel;
  window.leaveVoiceChannel = leaveVoiceChannel;
  window.toggleMute = toggleMute;
  window.toggleDeafen = toggleDeafen;

  startFirebase();
})();
