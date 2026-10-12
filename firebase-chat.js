(() => {
  const firebaseConfig = {
    apiKey: "AIzaSyAHczDpNDtuyU50fHuJBibi7lzN45FUzxg",
    authDomain: "my-project-aedf1.firebaseapp.com",
    projectId: "my-project-aedf1",
    appId: "1:802524733061:web:c1eafe8716f708ef49d3ec"
  };

  const channelNames = ["general", "announcements", "tech-lounge"];
  const voiceChannelNames = ["General Voice", "Gaming Room"];
  const defaultPrompt = "Sign in or create an account to join the global chat.";
  let auth = null;
  let db = null;
  let firebaseReady = false;
  let authMode = "signin";
  let authFlowBusy = false;
  let activeMessagesUnsubscribe = null;
  let userListUnsubscribe = null;
  let voiceListUnsubscribe = null;
  let conversationsUnsubscribe = null;
  let readObserver = null;
  let dmConversations = [];
  let profiles = new Map();
  let hiddenDms = new Set();
  let currentProfile = null;
  let voicePresence = [];
  let voiceHeartbeatTimer = null;

  try {
    localStorage.removeItem("ctcse_api_key");
  } catch (error) {
    console.warn("Unable to clear an old chat API key from browser storage", error);
  }

  const byId = id => document.getElementById(id);

  function status(message, connected = false) {
    byId("syncStatusText").textContent = message;
    byId("syncStatusDot").className = connected
      ? "w-2 h-2 rounded-full bg-emerald-400 animate-pulse"
      : "w-2 h-2 rounded-full bg-amber-300";
    byId("syncBadge").className = connected
      ? "ml-3 text-xs bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded-full border border-emerald-500/20 flex items-center gap-1.5 font-medium"
      : "ml-3 text-xs bg-amber-500/10 text-amber-300 px-2 py-0.5 rounded-full border border-amber-500/20 flex items-center gap-1.5 font-medium";
  }

  function setAuthStatus(message, isError = false) {
    const element = byId("authStatus");
    element.textContent = message;
    element.className = isError
      ? "text-sm text-rose-300 min-h-5"
      : "text-sm text-amber-300 min-h-5";
  }

  function showModal() {
    byId("userModal").classList.remove("hidden");
  }

  function hideModal() {
    byId("userModal").classList.add("hidden");
  }

  function configureAuthForm(mode, message = "") {
    authMode = mode;
    const signedIn = Boolean(auth && auth.currentUser);
    const profileMode = mode === "profile";
    const passwordMode = mode === "set-password";
    const settingsMode = mode === "settings";
    const emailField = byId("emailField");
    const username = byId("modalUsername");
    const email = byId("modalEmail");
    const password = byId("modalPassword");
    const hideCredentials = profileMode || passwordMode || settingsMode;

    byId("modalTitle").textContent = profileMode
      ? "Choose your username"
      : passwordMode
        ? "Set a password"
        : settingsMode
          ? "Account settings"
          : mode === "register"
            ? "Create your account"
            : "Welcome to CTCSE";
    byId("authDescription").textContent = profileMode
      ? "This username will identify you in chats. Old username-only profiles are not imported."
      : passwordMode
        ? "This account exists but has no password yet. Set one now to sign in with email and password next time."
        : settingsMode
          ? `Signed in as ${auth.currentUser.email || "your Google account"}.`
          : mode === "register"
            ? "Create a new account. Your email is your sign-in ID."
            : defaultPrompt;

    emailField.classList.toggle("hidden", hideCredentials);
    email.required = !hideCredentials;
    email.disabled = hideCredentials;
    username.classList.toggle("hidden", !profileMode);
    byId("usernameLabel").classList.toggle("hidden", !profileMode);
    username.required = profileMode;
    username.disabled = !profileMode;
    password.required = mode === "signin" || mode === "register" || passwordMode;
    password.disabled = settingsMode || profileMode;
    byId("passwordField").classList.toggle("hidden", settingsMode || profileMode);
    byId("passwordLabel").textContent = passwordMode ? "New password" : "Password";
    password.autocomplete = mode === "signin" ? "current-password" : "new-password";

    byId("authActions").classList.toggle("hidden", false);
    byId("authSubmitButton").classList.toggle("hidden", settingsMode);
    byId("authSubmitButton").textContent = profileMode
      ? "Continue"
      : passwordMode
        ? "Save password"
        : mode === "register"
          ? "Create account"
          : "Sign in";
    byId("authSwitchButton").classList.toggle("hidden", profileMode || passwordMode || settingsMode);
    byId("googleAuthButton").classList.toggle("hidden", profileMode || passwordMode || settingsMode);
    byId("resetPasswordButton").classList.toggle("hidden", mode !== "signin" && !settingsMode);
    byId("modalCloseBtn").classList.toggle("hidden", !signedIn || profileMode || passwordMode);
    setAuthStatus(message);
  }

  function firebaseIsConfigured() {
    return ["apiKey", "authDomain", "projectId", "appId"]
      .every(key => typeof firebaseConfig[key] === "string" && firebaseConfig[key].trim() !== "");
  }

  function startFirebase() {
    if (!window.firebase || !firebaseIsConfigured()) {
      status("Setup required");
      byId("firebaseSetupHint").classList.remove("hidden");
      byId("authActions").classList.add("hidden");
      byId("emailField").classList.add("hidden");
      byId("passwordField").classList.add("hidden");
      byId("authDescription").textContent = "Connect a Firebase project to enable secure global accounts and live chat.";
      setAuthStatus("Add Firebase web app settings and deploy Firestore security rules before signing in.", true);
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
          console.error("Firebase authentication setup failed", error);
          status("Connection error");
          showModal();
          setAuthStatus("Firebase sign-in could not start. Check your Firebase Auth configuration.", true);
        });
    } catch (error) {
      console.error("Firebase initialization failed", error);
      status("Connection error");
      showModal();
      setAuthStatus("Firebase could not initialize. Check the Firebase web app settings.", true);
    }
  }

  async function handleAuthChanged(user) {
    if (authFlowBusy) return;
    if (!user) {
      clearSubscriptions();
      currentProfile = null;
      currentUser.username = "";
      currentUser.uid = "";
      currentUser.tag = "";
      profiles = new Map();
      dmConversations = [];
      voicePresence = [];
      allChannelData = { general: [], announcements: [], "tech-lounge": [] };
      status("Signed out");
      configureAuthForm("signin");
      showModal();
      return;
    }
    if (currentUser.uid === user.uid && currentProfile) return;
    await finishSignIn(user);
  }

  async function finishSignIn(user) {
    try {
      const userSnapshot = await db.collection("users").doc(user.uid).get();
      if (!userSnapshot.exists) {
        if (user.providerData.some(provider => provider.providerId === "password")) {
          configureAuthForm("profile", "Choose a username to finish setting up your account.");
        } else {
          configureAuthForm("profile");
        }
        showModal();
        return;
      }
      currentProfile = userSnapshot.data();
      if (!user.providerData.some(provider => provider.providerId === "password")) {
        configureAuthForm("set-password");
        showModal();
        return;
      }
      enterChat(user, currentProfile);
    } catch (error) {
      console.error("Unable to load account profile", error);
      configureAuthForm("signin", "Could not load your profile. Check Firestore rules and try again.");
      showModal();
      status("Connection error");
    }
  }

  function enterChat(user, profile) {
    currentProfile = profile;
    currentUser.username = profile.username;
    currentUser.uid = user.uid;
    currentUser.tag = "#" + user.uid.slice(0, 4).toUpperCase();
    byId("userDisplayName").textContent = profile.username;
    byId("userTag").textContent = currentUser.tag;
    byId("userAvatar").src = avatarUrl(profile.username);
    byId("firebaseSetupHint").classList.add("hidden");
    byId("authActions").classList.remove("hidden");
    hideModal();
    hiddenDms = loadHiddenDms();
    syncFromCloud();
    switchChannel(channelNames.includes(currentChannel) ? currentChannel : "general");
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
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    await db.runTransaction(async transaction => {
      const [usernameSnapshot, userSnapshot] = await Promise.all([
        transaction.get(usernameRef),
        transaction.get(userRef)
      ]);
      if (usernameSnapshot.exists && usernameSnapshot.data().uid !== user.uid) {
        throw new Error("That username is already in use. Choose another one.");
      }
      transaction.set(usernameRef, { uid: user.uid, username });
      transaction.set(userRef, profile);
    });
    return profile;
  }

  async function submitAuth(event) {
    event.preventDefault();
    if (!firebaseReady) return;
    const email = byId("modalEmail").value.trim().toLowerCase();
    const password = byId("modalPassword").value;
    setAuthStatus("Working…");
    byId("authSubmitButton").disabled = true;

    try {
      if (authMode === "register") {
        const username = byId("modalUsername").value.trim();
        if (!validUsername(username)) {
          throw new Error("Username must be 3–20 characters and contain only letters, numbers, or underscores.");
        }
        if (password.length < 8) throw new Error("Choose a password with at least 8 characters.");
        authFlowBusy = true;
        const credential = await auth.createUserWithEmailAndPassword(email, password);
        try {
          const profile = await createProfile(credential.user, username);
          enterChat(credential.user, profile);
        } catch (error) {
          await credential.user.delete();
          throw error;
        }
      } else if (authMode === "profile") {
        const profile = await createProfile(auth.currentUser, byId("modalUsername").value.trim());
        currentProfile = profile;
        if (auth.currentUser.providerData.some(provider => provider.providerId === "password")) {
          enterChat(auth.currentUser, profile);
        } else {
          configureAuthForm("set-password");
        }
      } else if (authMode === "set-password") {
        if (password.length < 8) throw new Error("Choose a password with at least 8 characters.");
        const user = auth.currentUser;
        if (!user || !user.email) throw new Error("This account has no email address for password sign-in.");
        const credential = firebase.auth.EmailAuthProvider.credential(user.email, password);
        await user.linkWithCredential(credential);
        enterChat(user, currentProfile);
      } else {
        authFlowBusy = true;
        if (password.length < 8) throw new Error("Enter your password (at least 8 characters).");
        const credential = await auth.signInWithEmailAndPassword(email, password);
        await finishSignIn(credential.user);
      }
    } catch (error) {
      console.error("Sign-in action failed", error);
      authFlowBusy = false;
      const message = await explainAuthError(error, email);
      setAuthStatus(message, true);
    } finally {
      authFlowBusy = false;
      byId("authSubmitButton").disabled = false;
    }
  }

  async function explainAuthError(error, email) {
    if (error.message && !error.code) return error.message;
    if (error.code === "auth/email-already-in-use") return "An account already exists for this email. Sign in instead.";
    if (error.code === "auth/weak-password") return "Choose a stronger password with at least 8 characters.";
    if (error.code === "auth/invalid-email") return "Enter a valid email address.";
    if (error.code === "auth/invalid-credential" || error.code === "auth/wrong-password" || error.code === "auth/user-not-found") {
      try {
        const methods = await auth.fetchSignInMethodsForEmail(email);
        if (methods.length > 0 && !methods.includes("password")) {
          return "This account exists without a password. Sign in with Google, then set a password for this account.";
        }
      } catch (lookupError) {
        console.error("Unable to check sign-in methods", lookupError);
      }
      return "Email or password is incorrect. If you’re new, create an account first.";
    }
    if (error.code === "auth/popup-closed-by-user") return "Google sign-in was cancelled.";
    if (error.code === "auth/credential-already-in-use" || error.code === "auth/email-already-in-use") {
      return "That email already belongs to another account. Sign in to that account before linking a password.";
    }
    if (error.code === "permission-denied" || error.code === "firestore/permission-denied") {
      return "Firestore denied this action. Check that you deployed the included security rules.";
    }
    return error.message || "Sign-in failed. Check your connection and Firebase configuration.";
  }

  function switchAuthMode() {
    const nextMode = authMode === "signin" ? "register" : "signin";
    byId("modalUsername").value = "";
    byId("modalPassword").value = "";
    configureAuthForm(nextMode);
    byId("authSwitchButton").textContent = nextMode === "signin" ? "Create an account" : "Already have an account? Sign in";
    if (nextMode === "register") {
      byId("usernameLabel").classList.remove("hidden");
      byId("modalUsername").classList.remove("hidden");
      byId("modalUsername").required = true;
      byId("modalUsername").disabled = false;
      byId("authDescription").textContent = "Create a new account. Your email is your sign-in ID.";
    }
  }

  async function signInWithGoogle() {
    if (!firebaseReady) return;
    setAuthStatus("Opening Google sign-in…");
    try {
      authFlowBusy = true;
      const provider = new firebase.auth.GoogleAuthProvider();
      const result = await auth.signInWithPopup(provider);
      await finishSignIn(result.user);
    } catch (error) {
      console.error("Google sign-in failed", error);
      setAuthStatus(await explainAuthError(error, byId("modalEmail").value.trim()), true);
    } finally {
      authFlowBusy = false;
    }
  }

  async function sendPasswordReset() {
    if (!firebaseReady) return;
    const email = byId("modalEmail").value.trim().toLowerCase();
    if (!email) {
      setAuthStatus("Enter your email address first.", true);
      byId("modalEmail").focus();
      return;
    }
    try {
      await auth.sendPasswordResetEmail(email);
      setAuthStatus("If an account exists for that email, a password-reset link has been sent.");
    } catch (error) {
      console.error("Password reset request failed", error);
      setAuthStatus(await explainAuthError(error, email), true);
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
      if (activeVoiceChannel) {
        await updateVoiceParticipantsCloud(false);
        leaveVoiceChannel();
      }
      await auth.signOut();
    } catch (error) {
      console.error("Unable to sign out", error);
      status("Sign-out failed");
      setAuthStatus("Could not sign out. Please try again.", true);
    }
  }

  function clearSubscriptions() {
    [activeMessagesUnsubscribe, userListUnsubscribe, voiceListUnsubscribe, conversationsUnsubscribe]
      .forEach(unsubscribe => {
        if (unsubscribe) unsubscribe();
      });
    activeMessagesUnsubscribe = null;
    userListUnsubscribe = null;
    voiceListUnsubscribe = null;
    conversationsUnsubscribe = null;
    if (readObserver) readObserver.disconnect();
    readObserver = null;
    if (voiceHeartbeatTimer) window.clearInterval(voiceHeartbeatTimer);
    voiceHeartbeatTimer = null;
  }

  function syncFromCloud() {
    if (!firebaseReady || !auth.currentUser) return;
    clearSubscriptions();
    status("Connecting…");

    userListUnsubscribe = db.collection("users").onSnapshot(snapshot => {
      profiles = new Map(snapshot.docs.map(doc => [doc.id, { uid: doc.id, ...doc.data() }]));
      renderActiveUsersBoard();
      renderUserDmList();
      status("Live", true);
    }, error => reportSyncError(error));

    conversationsUnsubscribe = db.collection("directMessages")
      .where("participants", "array-contains", auth.currentUser.uid)
      .onSnapshot(async snapshot => {
        try {
          const entries = await Promise.all(snapshot.docs.map(async doc => {
            const otherUid = doc.data().participants.find(uid => uid !== auth.currentUser.uid);
            if (!otherUid) return null;
            let profile = profiles.get(otherUid);
            if (!profile) {
              const profileSnapshot = await db.collection("users").doc(otherUid).get();
              if (!profileSnapshot.exists) return null;
              profile = { uid: otherUid, ...profileSnapshot.data() };
              profiles.set(otherUid, profile);
            }
            return { id: doc.id, uid: otherUid, username: profile.username };
          }));
          dmConversations = entries.filter(Boolean);
          renderUserDmList();
        } catch (error) {
          reportSyncError(error);
        }
      }, error => reportSyncError(error));

    voiceListUnsubscribe = db.collection("voicePresence").onSnapshot(snapshot => {
      const activeSince = Date.now() - 60000;
      voicePresence = snapshot.docs
        .map(doc => ({ uid: doc.id, ...doc.data() }))
        .filter(item => item.updatedAt && item.updatedAt.toDate().getTime() >= activeSince);
      voiceParticipants = voicePresence.map(item => ({
        username: item.username,
        channel: item.channel,
        uid: item.uid
      }));
      updateVoiceChannelCounts();
      if (activeVoiceChannel) renderVoiceStage();
    }, error => reportSyncError(error));

  }

  function reportSyncError(error) {
    console.error("Firebase chat sync failed", error);
    status("Sync error");
    if (error.code === "permission-denied") {
      setAuthStatus("Chat sync was denied. Check that the included Firestore rules are deployed.", true);
    }
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
    if (!channel.startsWith("@") && !channelNames.includes(channel)) return;
    if (channel.startsWith("@") && !profiles.has(channel.slice(1))) return;
    currentChannel = channel;
    const isDm = channel.startsWith("@");
    const target = isDm ? profiles.get(channel.slice(1)) : null;
    byId("channelTitle").textContent = isDm ? `@${target.username}` : channel;
    byId("channelHeaderIcon").className = isDm
      ? "fa-solid fa-at text-gray-400 text-lg"
      : channel === "announcements"
        ? "fa-solid fa-bullhorn text-gray-400 text-lg"
        : "fa-solid fa-hashtag text-gray-400 text-lg";
    document.querySelectorAll(".channel-btn, #userDmList > div").forEach(button => {
      button.classList.remove("bg-[#404249]", "text-white");
      button.classList.add("text-gray-400");
    });
    const activeButton = document.getElementById(`chan-${channel}`);
    if (activeButton) {
      activeButton.classList.add("bg-[#404249]", "text-white");
      activeButton.classList.remove("text-gray-400");
    }
    byId("chatInput").placeholder = `Message ${isDm ? "@" + target.username : "#" + channel}...`;
    if (activeMessagesUnsubscribe) activeMessagesUnsubscribe();
    const feed = byId("messagesFeed");
    feed.replaceChildren();
    const loading = document.createElement("p");
    loading.className = "text-sm text-gray-400";
    loading.textContent = "Loading messages…";
    feed.appendChild(loading);
    activeMessagesUnsubscribe = getMessageCollection(channel)
      .orderBy("timestamp", "asc")
      .limit(200)
      .onSnapshot(snapshot => {
        allChannelData[roomKey(channel)] = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderFeed();
      }, error => reportSyncError(error));
  }

  function timestampToDate(timestamp) {
    if (timestamp && typeof timestamp.toDate === "function") return timestamp.toDate();
    if (typeof timestamp === "number") return new Date(timestamp);
    return new Date();
  }

  function renderFeed() {
    const feed = byId("messagesFeed");
    const shouldStickToBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 80;
    const messages = allChannelData[roomKey(currentChannel)] || [];
    if (readObserver) readObserver.disconnect();
    const observedChannel = currentChannel;
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
    const title = document.createElement("h1");
    title.className = "text-2xl font-bold text-white";
    title.textContent = `Welcome to ${currentChannel.startsWith("@")
      ? "@" + (profiles.get(currentChannel.slice(1))?.username || "direct message")
      : "#" + currentChannel}!`;
    const hint = document.createElement("p");
    hint.className = "text-sm text-gray-400 mt-1";
    hint.textContent = "Messages sync live. Select “Seen by” on a message to view its readers.";
    heading.append(title, hint);
    feed.appendChild(heading);

    if (messages.length === 0) {
      const empty = document.createElement("p");
      empty.className = "text-sm text-gray-400 py-6";
      empty.textContent = "No messages yet. Start the conversation.";
      feed.appendChild(empty);
    }

    messages.forEach(message => {
      const messageChannel = currentChannel;
      const article = document.createElement("article");
      article.className = "message-enter group relative flex items-start gap-3 hover:bg-[#2e3035] -mx-4 px-4 py-2 rounded";
      article.dataset.messageId = message.id;
      const avatar = document.createElement("img");
      avatar.src = avatarUrl(message.userName || "User");
      avatar.alt = "";
      avatar.className = "w-10 h-10 rounded-full bg-gray-700 shrink-0";
      const content = document.createElement("div");
      content.className = "min-w-0 flex-1";
      const meta = document.createElement("div");
      meta.className = "flex flex-wrap items-baseline gap-x-2";
      const sender = document.createElement("span");
      sender.className = "font-semibold text-white text-sm";
      sender.textContent = message.userName || "User";
      const sentAt = document.createElement("time");
      sentAt.className = "text-xs text-gray-400";
      sentAt.dateTime = timestampToDate(message.timestamp).toISOString();
      sentAt.textContent = timestampToDate(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      meta.append(sender, sentAt);
      const text = document.createElement("p");
      text.className = "text-gray-300 text-sm break-words whitespace-pre-wrap";
      text.textContent = message.text || "";
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
          readers.textContent = await getReaderNames(message.id, messageChannel);
        }
      });
      actions.append(seenButton);
      if (message.authorId === auth.currentUser.uid) {
        const removeButton = document.createElement("button");
        removeButton.type = "button";
        removeButton.className = "text-gray-500 hover:text-rose-400 text-xs transition";
        removeButton.title = "Delete message";
        removeButton.setAttribute("aria-label", "Delete message");
        removeButton.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
        removeButton.addEventListener("click", () => deleteMessage(message.id));
        actions.appendChild(removeButton);
      }
      actions.appendChild(readers);
      content.append(meta, text, actions);
      article.append(avatar, content);
      feed.appendChild(article);
      if (readObserver && message.authorId !== auth.currentUser.uid) readObserver.observe(article);
      else if (!readObserver && message.authorId !== auth.currentUser.uid) markMessageSeen(message.id, messageChannel);
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
      console.error("Unable to load message readers", error);
      return "Could not load readers. Check your connection and try again.";
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
      if (error.code !== "permission-denied") console.error("Unable to save read receipt", error);
    }
  }

  async function handleSend(event) {
    event.preventDefault();
    if (!auth || !auth.currentUser) return;
    const input = byId("chatInput");
    const text = input.value.trim();
    if (!text) return;
    if (text.length > 4000) {
      status("Message is too long");
      return;
    }
    try {
      const message = {
        authorId: auth.currentUser.uid,
        userName: currentProfile.username,
        text,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
      };
      await getMessageCollection(currentChannel).add(message);
      input.value = "";
      status("Live", true);
    } catch (error) {
      console.error("Unable to send message", error);
      status("Message not sent");
      setAuthStatus(await explainAuthError(error, auth.currentUser.email), true);
    }
  }

  async function deleteMessage(messageId) {
    try {
      await getMessageCollection(currentChannel).doc(messageId).delete();
    } catch (error) {
      console.error("Unable to delete message", error);
      status("Delete failed");
    }
  }

  async function addUserByUsername(event) {
    event.preventDefault();
    const input = byId("addUsernameInput");
    const username = input.value.trim();
    if (!username) return;
    try {
      const usernameDoc = await db.collection("usernames").doc(username.toLowerCase()).get();
      if (!usernameDoc.exists) {
        status("Account not found");
        return;
      }
      const targetUid = usernameDoc.data().uid;
      if (targetUid === auth.currentUser.uid) {
        status("You cannot message yourself");
        return;
      }
      await openDirectMessage(targetUid);
      input.value = "";
    } catch (error) {
      console.error("Unable to find account", error);
      status("Could not search accounts");
    }
  }

  async function openDirectMessage(targetUid) {
    const targetSnapshot = await db.collection("users").doc(targetUid).get();
    if (!targetSnapshot.exists) {
      status("Account not found");
      return;
    }
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
    hiddenDms.delete(conversationId);
    saveHiddenDms();
    switchChannel("@" + targetUid);
  }

  function addDmUserToSidebar(targetUser) {
    const profile = [...profiles.values()].find(item => item.username.toLowerCase() === targetUser.toLowerCase());
    if (profile) openDirectMessage(profile.uid);
  }

  function removeDmUser(targetUid, event) {
    if (event) event.stopPropagation();
    const conversationId = dmDocumentId(auth.currentUser.uid, targetUid);
    hiddenDms.add(conversationId);
    saveHiddenDms();
    renderUserDmList();
    if (currentChannel === "@" + targetUid) switchChannel("general");
  }

  function renderUserDmList() {
    const container = byId("userDmList");
    if (!container) return;
    container.replaceChildren();
    dmConversations.filter(item => !hiddenDms.has(item.id)).forEach(item => {
      const row = document.createElement("div");
      row.id = `chan-@${item.uid}`;
      row.className = "group relative flex items-center justify-between px-2 py-1.5 rounded hover:bg-[#35373c] text-gray-400 hover:text-gray-200 cursor-pointer text-sm font-medium";
      const open = document.createElement("button");
      open.type = "button";
      open.className = "flex items-center gap-2 truncate flex-1 text-left";
      open.addEventListener("click", () => switchChannel("@" + item.uid));
      const icon = document.createElement("i");
      icon.className = "fa-solid fa-at text-xs text-gray-400";
      const name = document.createElement("span");
      name.className = "truncate";
      name.textContent = item.username;
      open.append(icon, name);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.title = "Hide conversation";
      remove.setAttribute("aria-label", `Hide chat with ${item.username}`);
      remove.className = "opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-400 px-1 text-xs transition";
      remove.innerHTML = '<i class="fa-solid fa-xmark"></i>';
      remove.addEventListener("click", event => removeDmUser(item.uid, event));
      row.append(open, remove);
      container.appendChild(row);
    });
  }

  function loadHiddenDms() {
    try {
      const stored = JSON.parse(localStorage.getItem(`ctcse_hidden_dms_${auth.currentUser.uid}`) || "[]");
      return new Set(Array.isArray(stored) ? stored.filter(item => typeof item === "string") : []);
    } catch (error) {
      console.error("Unable to load hidden DM list", error);
      return new Set();
    }
  }

  function saveHiddenDms() {
    try {
      localStorage.setItem(`ctcse_hidden_dms_${auth.currentUser.uid}`, JSON.stringify([...hiddenDms]));
    } catch (error) {
      console.error("Unable to save hidden DM list", error);
    }
  }

  function renderActiveUsersBoard() {
    const container = byId("activeUsersList");
    container.replaceChildren();
    [...profiles.values()]
      .sort((left, right) => left.username.localeCompare(right.username))
      .forEach(profile => {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "flex items-center gap-2 p-1.5 hover:bg-[#35373c] rounded w-full text-left transition";
        const avatar = document.createElement("img");
        avatar.src = avatarUrl(profile.username);
        avatar.alt = "";
        avatar.className = "w-7 h-7 rounded-full bg-gray-700";
        const name = document.createElement("span");
        name.className = "text-sm font-medium text-gray-200 truncate flex-1";
        name.textContent = profile.username + (profile.uid === auth.currentUser.uid ? " (You)" : "");
        const online = voicePresence.some(item => item.uid === profile.uid);
        const dot = document.createElement("span");
        dot.className = `w-2 h-2 rounded-full ${online ? "bg-emerald-400" : "bg-gray-600"}`;
        row.append(avatar, name, dot);
        if (profile.uid !== auth.currentUser.uid) row.addEventListener("click", () => openDirectMessage(profile.uid));
        container.appendChild(row);
      });
  }

  function toggleUserBoard() {
    const board = byId("userBoard");
    board.classList.toggle("hidden");
    board.classList.toggle("open", !board.classList.contains("hidden"));
  }

  async function updateVoiceParticipantsCloud(isJoining) {
    if (!firebaseReady || !auth.currentUser) return;
    const presenceRef = db.collection("voicePresence").doc(auth.currentUser.uid);
    try {
      if (!isJoining || !activeVoiceChannel) {
        if (voiceHeartbeatTimer) window.clearInterval(voiceHeartbeatTimer);
        voiceHeartbeatTimer = null;
        await presenceRef.delete();
      } else {
        const updatePresence = () => presenceRef.set({
          username: currentProfile.username,
          channel: activeVoiceChannel,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        await updatePresence();
        if (!voiceHeartbeatTimer) voiceHeartbeatTimer = window.setInterval(updatePresence, 20000);
      }
    } catch (error) {
      console.error("Unable to update voice presence", error);
      status("Voice presence sync failed");
    }
  }

  function updateVoiceChannelCounts() {
    const counts = {};
    voicePresence.forEach(item => {
      counts[item.channel] = (counts[item.channel] || 0) + 1;
    });
    voiceChannelNames.forEach(channel => {
      const element = byId(`voice-count-${channel.replace(/\s+/g, "-")}`);
      if (element) {
        const count = counts[channel] || 0;
        element.textContent = count ? `${count} connected` : "";
      }
    });
    renderActiveUsersBoard();
  }

  function saveToCloud() {
    return Promise.resolve();
  }

  function initApp() {
    startFirebase();
  }

  window.initApp = initApp;
  window.submitAuth = submitAuth;
  window.switchAuthMode = switchAuthMode;
  window.signInWithGoogle = signInWithGoogle;
  window.sendPasswordReset = sendPasswordReset;
  window.openSettings = openSettings;
  window.closeSettings = closeSettings;
  window.signOut = signOut;
  window.switchChannel = switchChannel;
  window.renderFeed = renderFeed;
  window.handleSend = handleSend;
  window.deleteMessage = deleteMessage;
  window.addUserByUsername = addUserByUsername;
  window.addDmUserToSidebar = addDmUserToSidebar;
  window.removeDmUser = removeDmUser;
  window.renderUserDmList = renderUserDmList;
  window.toggleUserBoard = toggleUserBoard;
  window.syncFromCloud = syncFromCloud;
  window.saveToCloud = saveToCloud;
  window.updateVoiceParticipantsCloud = updateVoiceParticipantsCloud;
  window.updateVoiceChannelCounts = updateVoiceChannelCounts;

  initApp();
})();
