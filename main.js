// Konfigurasi Server Cloudflare
const SERVER_BASE_URL = "https://mahjong-pvp-server.owning.workers.dev";
const WS_SERVER_URL = "wss://mahjong-pvp-server.owning.workers.dev/ws";
const CLIENT_ID = "client_" + Math.random().toString(36).substring(2, 9);

// ================= SISTEM AKUN & AUTENTIKASI =================
let currentUser = null;
let friendList = [];
let pendingInviteRoom = null;
let pendingInviteGame = null;

let activeGame = "mahjong";

let socket = null;
let currentRoomCode = null;
let mySeatIndex = 0;
let isHost = false;

function generateFriendId() {
  return "#MG-" + Math.floor(1000 + Math.random() * 9000);
}

window.loginAsGuest = function () {
  const guestNum = Math.floor(100 + Math.random() * 900);
  currentUser = {
    id: "guest_" + Math.random().toString(36).substring(2, 8),
    friendId: null,
    nickname: "Tamu_" + guestNum,
    email: null,
    isGuest: true,
    avatar: "👤",
    wins: 0,
    matches: 0
  };
  saveCurrentSession();
  friendList = [];
  openHubScreen();
};

window.switchAuthTab = function (tab) {
  const tabLogin = document.getElementById("tab-login");
  const tabRegister = document.getElementById("tab-register");
  const formLogin = document.getElementById("form-login");
  const formRegister = document.getElementById("form-register");

  if (tab === "login") {
    tabLogin.classList.add("active");
    tabRegister.classList.remove("active");
    formLogin.classList.remove("hidden");
    formRegister.classList.add("hidden");
  } else {
    tabRegister.classList.add("active");
    tabLogin.classList.remove("active");
    formRegister.classList.remove("hidden");
    formLogin.classList.add("hidden");
  }
};

window.handleEmailRegister = async function (e) {
  e.preventDefault();
  const nick = document.getElementById("reg-nickname").value.trim();
  const email = document.getElementById("reg-email").value.trim().toLowerCase();
  const pass = document.getElementById("reg-pass").value;

  try {
    const res = await fetch(`${SERVER_BASE_URL}/api/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: pass, nickname: nick })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || "Gagal mendaftar akun!");
      return;
    }

    currentUser = { ...data.user, isGuest: false };
    saveCurrentSession();
    alert(`Akun berhasil dibuat di Cloud Server! ID Anda: ${currentUser.friendId}`);
    await fetchServerFriends();
    openHubScreen();
  } catch (err) {
    alert("Gagal menghubungi server database: " + err.message);
  }
};

window.handleEmailLogin = async function (e) {
  e.preventDefault();
  const email = document.getElementById("login-email").value.trim().toLowerCase();
  const pass = document.getElementById("login-pass").value;

  try {
    const res = await fetch(`${SERVER_BASE_URL}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: pass })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || "Email atau kata sandi salah!");
      return;
    }

    currentUser = { ...data.user, isGuest: false };
    saveCurrentSession();
    await fetchServerFriends();
    openHubScreen();
  } catch (err) {
    alert("Gagal menghubungi server database: " + err.message);
  }
};

window.handleLogout = function () {
  currentUser = null;
  localStorage.removeItem("bgh_active_session");
  backToAuthScreen();
};

function saveCurrentSession() {
  localStorage.setItem("bgh_active_session", JSON.stringify(currentUser));
}

async function checkAutoLogin() {
  const session = localStorage.getItem("bgh_active_session");
  if (session) {
    try {
      currentUser = JSON.parse(session);
      if (!currentUser.isGuest) {
        await fetchServerFriends();
      }
      openHubScreen();
      return;
    } catch (e) {}
  }
  backToAuthScreen();
}

function backToAuthScreen() {
  document.getElementById("auth-screen").classList.remove("hidden");
  document.getElementById("hub-screen").classList.add("hidden");
  document.getElementById("lobby-screen").classList.add("hidden");
  document.getElementById("game-table").classList.add("hidden");
  document.getElementById("snakes-screen").classList.add("hidden");
}

function openHubScreen() {
  updateUserHubUI();
  document.getElementById("auth-screen").classList.add("hidden");
  document.getElementById("hub-screen").classList.remove("hidden");
  document.getElementById("lobby-screen").classList.add("hidden");
  document.getElementById("game-table").classList.add("hidden");
  document.getElementById("snakes-screen").classList.add("hidden");

  if (currentUser && !currentUser.isGuest) {
    initLobbyHubSocket();
  }
}

function updateUserHubUI() {
  if (!currentUser) return;
  const hubAvatar = document.getElementById("hub-avatar");
  const hubNick = document.getElementById("hub-nickname");
  const hubType = document.getElementById("hub-account-type");
  const myFriendIdEl = document.getElementById("my-friend-id");
  const lobbyUserTag = document.getElementById("lobby-user-tag");
  const btnHubFriends = document.getElementById("btn-hub-friends");
  const btnLobbyInvite = document.getElementById("btn-lobby-invite");

  if (hubAvatar) hubAvatar.innerText = currentUser.avatar;
  if (hubNick) hubNick.innerText = currentUser.nickname;

  if (currentUser.isGuest) {
    if (hubType) hubType.innerText = "Mode Tamu (Hanya Kode Room)";
    if (lobbyUserTag) lobbyUserTag.innerText = `${currentUser.avatar} ${currentUser.nickname} (Guest)`;
    if (btnHubFriends) btnHubFriends.classList.add("hidden");
    if (btnLobbyInvite) btnLobbyInvite.classList.add("hidden");
  } else {
    if (hubType) hubType.innerText = `ID: ${currentUser.friendId}`;
    if (myFriendIdEl) myFriendIdEl.innerText = currentUser.friendId;
    if (lobbyUserTag) lobbyUserTag.innerText = `${currentUser.avatar} ${currentUser.nickname} (${currentUser.friendId})`;
    if (btnHubFriends) btnHubFriends.classList.remove("hidden");
    if (btnLobbyInvite) btnLobbyInvite.classList.remove("hidden");
  }
}

async function fetchServerFriends() {
  if (!currentUser || currentUser.isGuest) return;
  try {
    const res = await fetch(`${SERVER_BASE_URL}/api/friends?friendId=${encodeURIComponent(currentUser.friendId)}`);
    const data = await res.json();
    friendList = data.friends || [];
  } catch (e) {
    friendList = [];
  }
}

window.openFriendsModal = function () {
  if (currentUser && currentUser.isGuest) {
    alert("Fitur Teman hanya untuk akun email terdaftar!");
    return;
  }
  updateFriendsListUI();
  document.getElementById("friends-modal").classList.remove("hidden");
};

window.closeFriendsModal = function () {
  document.getElementById("friends-modal").classList.add("hidden");
};

window.copyMyFriendId = function () {
  if (!currentUser || currentUser.isGuest) return;
  navigator.clipboard.writeText(currentUser.friendId).then(() => {
    alert(`ID ${currentUser.friendId} disalin!`);
  });
};

window.addFriendById = async function () {
  if (currentUser && currentUser.isGuest) return;

  const input = document.getElementById("input-friend-id");
  let fId = (input ? input.value : "").trim().toUpperCase();

  if (!fId.startsWith("#MG-")) {
    fId = "#MG-" + fId.replace("#", "").replace("MG-", "");
  }

  if (fId === currentUser.friendId) {
    alert("Tidak bisa menambahkan ID sendiri!");
    return;
  }

  try {
    const res = await fetch(`${SERVER_BASE_URL}/api/add-friend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ myFriendId: currentUser.friendId, targetFriendId: fId })
    });
    const data = await res.json();

    if (!res.ok) {
      alert(data.error || "Gagal menambahkan teman!");
      return;
    }

    alert(`Berhasil menambahkan ${data.friend.nickname} (${fId})!`);
    await fetchServerFriends();
    updateFriendsListUI();
    if (input) input.value = "";
  } catch (err) {
    alert("Gagal koneksi ke database: " + err.message);
  }
};

function updateFriendsListUI() {
  const container = document.getElementById("friends-list");
  if (!container) return;

  if (friendList.length === 0) {
    container.innerHTML = '<div class="empty-friends">Belum ada teman. Masukkan ID teman di atas.</div>';
    return;
  }

  container.innerHTML = "";
  friendList.forEach((friend) => {
    const item = document.createElement("div");
    item.className = "friend-item";
    item.innerHTML = `
      <div class="friend-info-left">
        <div class="friend-name-tag">${friend.avatar} ${friend.nickname}</div>
        <div class="friend-id-tag">${friend.friendId}</div>
      </div>
      <div>
        <button type="button" class="btn btn-action btn-sm" onclick="inviteFriendToPlay('${friend.friendId}')">Undang</button>
      </div>
    `;
    container.appendChild(item);
  });
}

window.inviteFriendToPlay = function (targetFriendId) {
  if (currentUser && currentUser.isGuest) return;
  if (!currentRoomCode) {
    startCreateRoom();
  }

  sendSocketMessage({
    type: "INVITE_FRIEND",
    targetFriendId: targetFriendId,
    fromUser: {
      friendId: currentUser.friendId,
      nickname: currentUser.nickname,
      avatar: currentUser.avatar
    },
    room: currentRoomCode,
    game: activeGame
  });

  alert(`Undangan Room (${currentRoomCode}) dikirim ke ${targetFriendId}!`);
  closeFriendsModal();
};

function showInviteNotification(inviter, roomCode, gameType) {
  const banner = document.getElementById("invite-notification");
  const textEl = document.getElementById("invite-text");
  const acceptBtn = document.getElementById("btn-accept-invite");

  pendingInviteRoom = roomCode;
  pendingInviteGame = gameType || "mahjong";
  textEl.innerText = `${inviter.nickname} mengundang ke ${pendingInviteGame.toUpperCase()} (Room: ${roomCode})!`;

  acceptBtn.onclick = function () {
    closeInviteNotification();
    activeGame = pendingInviteGame;
    enterRoom(pendingInviteRoom);
  };

  banner.classList.remove("hidden");
}

window.closeInviteNotification = function () {
  document.getElementById("invite-notification").classList.add("hidden");
  pendingInviteRoom = null;
  pendingInviteGame = null;
};

let globalHubSocket = null;
function initLobbyHubSocket() {
  if (globalHubSocket || (currentUser && currentUser.isGuest)) return;
  try {
    globalHubSocket = new WebSocket(WS_SERVER_URL);
    globalHubSocket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "INVITE_FRIEND" && currentUser && !currentUser.isGuest) {
          if (msg.targetFriendId === currentUser.friendId) {
            showInviteNotification(msg.fromUser, msg.room, msg.game);
          }
        }
      } catch (e) {}
    };
  } catch (err) {}
}

window.selectGame = function (gameName) {
  if (gameName === "mahjong" || gameName === "snakes") {
    activeGame = gameName;
    document.getElementById("hub-screen").classList.add("hidden");
    document.getElementById("lobby-screen").classList.remove("hidden");

    const titleEl = document.getElementById("lobby-game-title");
    const mahjongSettings = document.getElementById("mahjong-settings");
    const snakesSettings = document.getElementById("snakes-settings");

    if (gameName === "mahjong") {
      titleEl.innerText = "Lobi Mahjong PvP";
      mahjongSettings.classList.remove("hidden");
      snakesSettings.classList.add("hidden");
    } else {
      titleEl.innerText = "Lobi Ular Tangga";
      mahjongSettings.classList.add("hidden");
      snakesSettings.classList.remove("hidden");
    }
    updateUserHubUI();
  } else {
    alert("Board game ini sedang dalam tahap perakitan!");
  }
};

window.backToHub = function () {
  if (turnTimerInterval) clearInterval(turnTimerInterval);
  if (botActionTimer) clearTimeout(botActionTimer);
  if (snakesTurnTimer) clearInterval(snakesTurnTimer);

  if (socket) {
    try { socket.close(); } catch (e) {}
    socket = null;
  }

  document.getElementById("game-table").classList.add("hidden");
  document.getElementById("snakes-screen").classList.add("hidden");
  document.getElementById("lobby-screen").classList.add("hidden");
  document.getElementById("hub-screen").classList.remove("hidden");
  currentRoomCode = null;
  updateUserHubUI();
};

function startCreateRoom() {
  const code = Math.floor(1000 + Math.random() * 9000).toString();
  isHost = true;
  mySeatIndex = 0;
  enterRoom(code);
}

function startJoinRoom() {
  const inputEl = document.getElementById("input-room-code");
  const code = (inputEl ? inputEl.value : "").trim().toUpperCase();
  if (code.length < 4) {
    alert("Masukkan 4 digit kode ruangan yang valid!");
    return;
  }
  isHost = false;
  enterRoom(code);
}

function enterRoom(code) {
  currentRoomCode = code;
  document.getElementById("lobby-screen").classList.add("hidden");

  if (activeGame === "mahjong") {
    enterMahjongRoom(code);
  } else if (activeGame === "snakes") {
    enterSnakesRoom(code);
  }
}

function sendSocketMessage(payload) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    payload.room = currentRoomCode;
    payload.game = activeGame;
    payload.senderId = CLIENT_ID;
    socket.send(JSON.stringify(payload));
  } else if (globalHubSocket && globalHubSocket.readyState === WebSocket.OPEN) {
    payload.senderId = CLIENT_ID;
    globalHubSocket.send(JSON.stringify(payload));
  }
}

// ================= GAME 2: ULAR TANGGA =================
const SNAKES_LADDERS_MAP = {
  4: 14, 9: 31, 20: 38, 28: 84, 40: 59, 51: 67, 63: 81, 71: 91,
  17: 7, 54: 34, 62: 19, 64: 60, 87: 24, 93: 73, 95: 75, 99: 78
};

let snakesPositions = [1, 1, 1, 1];
let snakesCurrentTurn = 0;
let snakesIsRolling = false;
let snakesTurnTimer = null;
let snakesTimeRemaining = 15;
let snakesPlayerNames = ["Anda", "P2 (Bot)", "P3 (Bot)", "P4 (Bot)"];

function renderDiceFaceHTML(val) {
  switch (val) {
    case 1:
      return `<span class="pip pip-center pip-gold"></span>`;
    case 2:
      return `<span class="pip pip-tl"></span><span class="pip pip-br"></span>`;
    case 3:
      return `<span class="pip pip-tl"></span><span class="pip pip-center"></span><span class="pip pip-br"></span>`;
    case 4:
      return `<span class="pip pip-tl"></span><span class="pip pip-tr"></span><span class="pip pip-bl"></span><span class="pip pip-br"></span>`;
    case 5:
      return `<span class="pip pip-tl"></span><span class="pip pip-tr"></span><span class="pip pip-center"></span><span class="pip pip-bl"></span><span class="pip pip-br"></span>`;
    case 6:
      return `<span class="pip pip-tl"></span><span class="pip pip-tr"></span><span class="pip pip-ml"></span><span class="pip pip-mr"></span><span class="pip pip-bl"></span><span class="pip pip-br"></span>`;
    default:
      return `<span class="pip pip-center pip-gold"></span>`;
  }
}

function updateDiceVisual(val) {
  const diceVisual = document.getElementById("dice-visual");
  if (!diceVisual) return;
  diceVisual.innerHTML = renderDiceFaceHTML(val);
}

function initSnakesBoardUI() {
  const boardEl = document.getElementById("snakes-board");
  if (!boardEl) return;
  boardEl.innerHTML = "";

  for (let row = 9; row >= 0; row--) {
    const isEvenRow = (row % 2 === 0);
    for (let col = 0; col < 10; col++) {
      const cellNum = row * 10 + (isEvenRow ? (col + 1) : (10 - col));
      const cell = document.createElement("div");
      cell.className = `snakes-cell ${(row + col) % 2 === 0 ? "cell-alt" : ""}`;
      cell.id = `cell-${cellNum}`;

      cell.innerHTML = `<span>${cellNum}</span>`;

      if (SNAKES_LADDERS_MAP[cellNum]) {
        const dest = SNAKES_LADDERS_MAP[cellNum];
        if (dest > cellNum) {
          cell.classList.add("cell-ladder");
          cell.innerHTML += `<span class="cell-icon">🪜${dest}</span>`;
        } else {
          cell.classList.add("cell-snake");
          cell.innerHTML += `<span class="cell-icon">🐍${dest}</span>`;
        }
      }

      const pawnsHolder = document.createElement("div");
      pawnsHolder.className = "pawns-holder";
      pawnsHolder.id = `pawns-cell-${cellNum}`;
      cell.appendChild(pawnsHolder);

      boardEl.appendChild(cell);
    }
  }

  renderAllPawns();
}

function renderAllPawns() {
  document.querySelectorAll(".pawns-holder").forEach(el => el.innerHTML = "");

  snakesPositions.forEach((pos, playerIdx) => {
    const targetCellHolder = document.getElementById(`pawns-cell-${pos}`);
    if (targetCellHolder) {
      const pawn = document.createElement("div");
      pawn.className = `pawn pawn-${playerIdx}`;
      targetCellHolder.appendChild(pawn);
    }

    const pNameEl = document.getElementById(`p-name-${playerIdx}`);
    if (pNameEl) {
      pNameEl.innerText = `${snakesPlayerNames[playerIdx]}: ${pos}`;
    }
  });

  for (let i = 0; i < 4; i++) {
    const pill = document.getElementById(`p-pill-${i}`);
    if (pill) {
      if (i === snakesCurrentTurn) pill.classList.add("active-turn");
      else pill.classList.remove("active-turn");
    }
  }
}

function enterSnakesRoom(code) {
  const table = document.getElementById("snakes-screen");
  const roomBadge = document.getElementById("snakes-room-badge");
  if (roomBadge) roomBadge.innerText = `ROOM: ${code}`;
  table.classList.remove("hidden");

  snakesPositions = [1, 1, 1, 1];
  snakesCurrentTurn = 0;
  snakesPlayerNames[0] = `${currentUser.avatar} ${currentUser.nickname}`;

  initSnakesBoardUI();
  updateDiceVisual(1);
  initSnakesNetwork();
  startSnakesTurn(0);
}

function initSnakesNetwork() {
  const statusBar = document.getElementById("snakes-status-bar");
  try {
    socket = new WebSocket(WS_SERVER_URL);

    socket.onopen = () => {
      sendSocketMessage({
        type: "JOIN_ROOM",
        room: currentRoomCode,
        isHost: isHost,
        game: "snakes",
        user: {
          nickname: currentUser.nickname,
          avatar: currentUser.avatar
        }
      });
    };

    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.room !== currentRoomCode || msg.senderId === CLIENT_ID) return;

        if (msg.type === "DICE_ROLLED") {
          applyDiceRollResult(msg.playerSeat, msg.diceValue, msg.newPosition);
        } else if (msg.type === "TURN_UPDATE") {
          startSnakesTurn(msg.seat);
        }
      } catch (e) {}
    };

    socket.onerror = () => {
      statusBar.innerText = "Mode Offline (Simulasi Lokal)";
    };
  } catch (err) {
    statusBar.innerText = "Mode Offline (Simulasi Lokal)";
  }
}

function startSnakesTurn(seatIndex) {
  snakesCurrentTurn = seatIndex;
  snakesIsRolling = false;

  const statusBar = document.getElementById("snakes-status-bar");
  const diceWrapper = document.getElementById("dice-wrapper");
  const diceHint = document.getElementById("dice-hint");

  renderAllPawns();
  startSnakesTurnTimer();

  if (snakesCurrentTurn === mySeatIndex) {
    if (statusBar) statusBar.innerText = "Giliran Anda! Ketuk dadu di bawah:";
    if (diceWrapper) diceWrapper.classList.add("my-turn");
    if (diceHint) {
      diceHint.innerText = "KETUK DADU!";
      diceHint.style.opacity = "1";
    }
  } else {
    if (statusBar) statusBar.innerText = `Giliran ${snakesPlayerNames[snakesCurrentTurn]} melempar dadu...`;
    if (diceWrapper) diceWrapper.classList.remove("my-turn");
    if (diceHint) {
      diceHint.innerText = "MENUNGGU...";
      diceHint.style.opacity = "0.5";
    }

    if (isHost && snakesCurrentTurn !== mySeatIndex) {
      setTimeout(() => {
        executeBotDiceRoll(snakesCurrentTurn);
      }, 2000);
    }
  }
}

function startSnakesTurnTimer() {
  clearInterval(snakesTurnTimer);
  snakesTimeRemaining = 15;
  const countEl = document.getElementById("snakes-timer-count");
  if (countEl) countEl.innerText = snakesTimeRemaining;

  snakesTurnTimer = setInterval(() => {
    snakesTimeRemaining--;
    if (countEl) countEl.innerText = snakesTimeRemaining;

    if (snakesTimeRemaining <= 0) {
      clearInterval(snakesTurnTimer);
      if (snakesCurrentTurn === mySeatIndex && !snakesIsRolling) {
        handleRollDiceClick();
      }
    }
  }, 1000);
}

window.handleRollDiceClick = function () {
  if (snakesCurrentTurn !== mySeatIndex || snakesIsRolling) return;
  executePlayerDiceRoll(mySeatIndex);
};

function executePlayerDiceRoll(playerSeat) {
  snakesIsRolling = true;
  const diceWrapper = document.getElementById("dice-wrapper");
  const diceVisual = document.getElementById("dice-visual");
  const diceHint = document.getElementById("dice-hint");

  if (diceWrapper) diceWrapper.classList.remove("my-turn");
  if (diceVisual) diceVisual.classList.add("rolling");
  if (diceHint) diceHint.innerText = "MENGOCOK...";

  const shuffleInterval = setInterval(() => {
    const randomTemp = Math.floor(1 + Math.random() * 6);
    updateDiceVisual(randomTemp);
  }, 90);

  setTimeout(() => {
    clearInterval(shuffleInterval);
    if (diceVisual) diceVisual.classList.remove("rolling");

    const diceValue = Math.floor(1 + Math.random() * 6);
    updateDiceVisual(diceValue);

    let currentPos = snakesPositions[playerSeat];
    let nextPos = currentPos + diceValue;

    if (nextPos > 100) {
      const overshoot = nextPos - 100;
      nextPos = 100 - overshoot;
    }

    if (SNAKES_LADDERS_MAP[nextPos]) {
      nextPos = SNAKES_LADDERS_MAP[nextPos];
    }

    sendSocketMessage({
      type: "DICE_ROLLED",
      playerSeat: playerSeat,
      diceValue: diceValue,
      newPosition: nextPos
    });

    applyDiceRollResult(playerSeat, diceValue, nextPos);
  }, 650);
}

function executeBotDiceRoll(botSeat) {
  if (snakesCurrentTurn !== botSeat || snakesIsRolling) return;
  executePlayerDiceRoll(botSeat);
}

function applyDiceRollResult(playerSeat, diceValue, finalPosition) {
  const statusBar = document.getElementById("snakes-status-bar");
  const diceHint = document.getElementById("dice-hint");

  updateDiceVisual(diceValue);
  if (diceHint) diceHint.innerText = `ANGKA ${diceValue}`;
  if (statusBar) statusBar.innerText = `${snakesPlayerNames[playerSeat]} melempar ${diceValue}! Maju ke kotak ${finalPosition}.`;

  snakesPositions[playerSeat] = finalPosition;
  renderAllPawns();

  if (finalPosition === 100) {
    clearInterval(snakesTurnTimer);
    setTimeout(() => {
      alert(`🎉 SELAMAT! ${snakesPlayerNames[playerSeat]} MENANG mencapai kotak 100!`);
      backToHub();
    }, 500);
    return;
  }

  const gotSix = (diceValue === 6);
  setTimeout(() => {
    snakesIsRolling = false;
    if (gotSix) {
      if (statusBar) statusBar.innerText = `${snakesPlayerNames[playerSeat]} dapat angka 6! Lempar dadu sekali lagi!`;
      startSnakesTurn(playerSeat);
    } else {
      const nextSeat = (playerSeat + 1) % 4;
      if (isHost) {
        sendSocketMessage({ type: "TURN_UPDATE", seat: nextSeat });
      }
      startSnakesTurn(nextSeat);
    }
  }, 1200);
}

// ================= GAME 1: MAHJONG MEJA REALISTIS SOLITAIRE ICONIC =================
let currentGameMode = "HK";
let assistLevel = "BEGINNER";
let playerPoints = [25000, 25000, 25000, 25000];
let playerNames = ["Anda", "P2 (Bot)", "P3 (Bot)", "P4 (Bot)"];
let isRiichiDeclared = false;
let exposedMelds = [[], [], [], []];
let botHands = [[], [], [], []];
let wallDeck = [];
let myHand = [];
let currentTurnSeat = -1;
let turnTimeRemaining = 15;
let turnTimerInterval = null;
let botActionTimer = null;
let isProcessingTurn = false;
let lastDiscardedTile = null;
let lastDiscarderSeat = -1;
let lastDiscardElement = null;
let doraTile = null;

// Variabel Kontrol Drag and Drop
let draggedIndex = null;
let touchStartX = 0;
let touchStartY = 0;
let isTouchDragging = false;
let activeDragElement = null;

function renderSolitaireTileSVG(suit, num, name) {
  if (suit === "Wan") {
    const kanjiNumbers = ["一", "二", "三", "四", "五", "六", "七", "八", "九"];
    const digit = kanjiNumbers[num - 1] || num;
    const digitColor = (num === 1 || num === 5) ? "#c0392b" : "#1a252f";
    return `
      <svg class="tile-icon-svg" viewBox="0 0 32 44">
        <text x="16" y="17" font-size="16" font-weight="900" fill="${digitColor}" text-anchor="middle" font-family="'Noto Sans SC', sans-serif">${digit}</text>
        <text x="16" y="37" font-size="18" font-weight="900" fill="#d63031" text-anchor="middle" font-family="'Noto Sans SC', sans-serif">萬</text>
      </svg>
    `;
  }

  if (suit === "Pin") {
    if (num === 1) {
      return `
        <svg class="tile-icon-svg" viewBox="0 0 32 44">
          <circle cx="16" cy="22" r="13" fill="#d63031" stroke="#c0392b" stroke-width="1.5"/>
          <circle cx="16" cy="22" r="7" fill="#f1c40f"/>
          <circle cx="16" cy="22" r="3" fill="#d63031"/>
        </svg>
      `;
    }
    if (num === 2) {
      return `
        <svg class="tile-icon-svg" viewBox="0 0 32 44">
          <circle cx="16" cy="12" r="6" fill="#0984e3"/>
          <circle cx="16" cy="32" r="6" fill="#00b894"/>
        </svg>
      `;
    }
    if (num === 3) {
      return `
        <svg class="tile-icon-svg" viewBox="0 0 32 44">
          <circle cx="8" cy="10" r="5" fill="#0984e3"/>
          <circle cx="16" cy="22" r="5" fill="#d63031"/>
          <circle cx="24" cy="34" r="5" fill="#00b894"/>
        </svg>
      `;
    }
    if (num === 4) {
      return `
        <svg class="tile-icon-svg" viewBox="0 0 32 44">
          <circle cx="9" cy="12" r="5" fill="#0984e3"/>
          <circle cx="23" cy="12" r="5" fill="#00b894"/>
          <circle cx="9" cy="32" r="5" fill="#00b894"/>
          <circle cx="23" cy="32" r="5" fill="#0984e3"/>
        </svg>
      `;
    }
    return `
      <svg class="tile-icon-svg" viewBox="0 0 32 44">
        <circle cx="16" cy="22" r="4.5" fill="#d63031"/>
        <circle cx="8.5" cy="11" r="4" fill="#0984e3"/>
        <circle cx="23.5" cy="11" r="4" fill="#00b894"/>
        <circle cx="8.5" cy="33" r="4" fill="#00b894"/>
        <circle cx="23.5" cy="33" r="4" fill="#0984e3"/>
      </svg>
    `;
  }

  if (suit === "Sou") {
    if (num === 1) {
      return `
        <svg class="tile-icon-svg" viewBox="0 0 32 44">
          <path d="M16 8 C11 8 8 14 8 22 C8 30 13 36 16 36 C19 36 24 30 24 22 C24 14 21 8 16 8 Z" fill="#00b894"/>
          <circle cx="16" cy="15" r="3.5" fill="#d63031"/>
          <circle cx="16" cy="25" r="2.5" fill="#f1c40f"/>
        </svg>
      `;
    }
    return `
      <svg class="tile-icon-svg" viewBox="0 0 32 44">
        <rect x="14" y="6" width="4.5" height="32" rx="2" fill="#00b894"/>
        <rect x="7" y="10" width="4.5" height="24" rx="2" fill="#0984e3"/>
        <rect x="21" y="10" width="4.5" height="24" rx="2" fill="#0984e3"/>
        <circle cx="16.25" cy="22" r="2" fill="#d63031"/>
      </svg>
    `;
  }

  if (suit === "Honor") {
    if (name === "Zhong" || num === 5) {
      return `
        <svg class="tile-icon-svg" viewBox="0 0 32 44">
          <text x="16" y="32" font-size="30" font-weight="900" fill="#d63031" text-anchor="middle" font-family="'Noto Sans SC', sans-serif">中</text>
        </svg>
      `;
    }
    if (name === "Fa" || num === 6) {
      return `
        <svg class="tile-icon-svg" viewBox="0 0 32 44">
          <text x="16" y="32" font-size="28" font-weight="900" fill="#00b894" text-anchor="middle" font-family="'Noto Sans SC', sans-serif">發</text>
        </svg>
      `;
    }
    if (name === "Bai" || num === 7) {
      return `
        <svg class="tile-icon-svg" viewBox="0 0 32 44">
          <rect x="6" y="8" width="20" height="28" rx="4" fill="none" stroke="#0984e3" stroke-width="3"/>
        </svg>
      `;
    }
    const windMap = { Dong: "東", Nan: "南", Xi: "西", Bei: "北" };
    return `
      <svg class="tile-icon-svg" viewBox="0 0 32 44">
        <text x="16" y="32" font-size="28" font-weight="900" fill="#1b4f72" text-anchor="middle" font-family="'Noto Sans SC', sans-serif">${windMap[name] || name}</text>
      </svg>
    `;
  }

  return `<svg class="tile-icon-svg" viewBox="0 0 32 44"><text x="16" y="26" font-size="14" fill="#333" text-anchor="middle">${name}</text></svg>`;
}

function getTileHTML(tile) {
  if (!tile) return "";
  if (tile.svg) return tile.svg;
  return renderSolitaireTileSVG(tile.suit, tile.num, tile.name);
}

function createFullDeck() {
  const deck = [];
  const suits = [
    { name: "Wan", order: 1, count: 9 },
    { name: "Pin", order: 2, count: 9 },
    { name: "Sou", order: 3, count: 9 }
  ];

  suits.forEach((suit) => {
    for (let num = 1; num <= suit.count; num++) {
      for (let i = 0; i < 4; i++) {
        deck.push({
          id: `${num}_${suit.name}_${i}`,
          suit: suit.name,
          num: num,
          order: suit.order,
          svg: renderSolitaireTileSVG(suit.name, num, `${num}${suit.name[0]}`)
        });
      }
    }
  });

  const honors = ["Dong", "Nan", "Xi", "Bei", "Zhong", "Fa", "Bai"];
  honors.forEach((hName, idx) => {
    for (let i = 0; i < 4; i++) {
      deck.push({
        id: `honor_${hName}_${i}`,
        suit: "Honor",
        name: hName,
        num: idx + 1,
        order: 4,
        svg: renderSolitaireTileSVG("Honor", idx + 1, hName)
      });
    }
  });

  return shuffleDeck(deck);
}

function shuffleDeck(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function enterMahjongRoom(code) {
  const table = document.getElementById("game-table");
  const badge = document.getElementById("room-badge");
  const ruleBadge = document.getElementById("rule-badge");
  const levelBadge = document.getElementById("level-badge");
  const doraBar = document.getElementById("dora-bar");

  if (badge) badge.innerText = `ROOM: ${code}`;
  if (ruleBadge) ruleBadge.innerText = currentGameMode;
  if (levelBadge) levelBadge.innerText = assistLevel;

  table.classList.remove("hidden");
  playerNames[0] = `${currentUser.avatar} ${currentUser.nickname}`;

  if (currentGameMode === "RIICHI" && doraBar) {
    doraBar.classList.remove("hidden");
  }

  if (assistLevel === "INTERMEDIATE") {
    showIntermediateManualButtons();
  }

  initMahjongNetwork();

  if (isHost) {
    wallDeck = createFullDeck();
    myHand = wallDeck.splice(0, 13);
    botHands[1] = wallDeck.splice(0, 13);
    botHands[2] = wallDeck.splice(0, 13);
    botHands[3] = wallDeck.splice(0, 13);

    if (currentGameMode === "RIICHI") {
      doraTile = wallDeck.pop();
      updateDoraUI();
    }
    sortMyHand();
    renderOpponents();
    updateSeatsInfo();

    setTimeout(() => {
      moveToNextTurn(0);
    }, 1000);
  } else {
    const statusBar = document.getElementById("status-bar");
    if (statusBar) statusBar.innerText = `Bergabung ke ROOM ${code}. Menunggu Host...`;
    renderOpponents();
  }
}

function updateDoraUI() {
  const doraEl = document.getElementById("dora-tile");
  if (doraEl && doraTile) {
    doraEl.className = "tile discarded dora-highlight";
    doraEl.innerHTML = getTileHTML(doraTile);
  }
}

function initMahjongNetwork() {
  const statusBar = document.getElementById("status-bar");
  try {
    socket = new WebSocket(WS_SERVER_URL);

    socket.onopen = () => {
      sendSocketMessage({
        type: "JOIN_ROOM",
        room: currentRoomCode,
        isHost: isHost,
        mode: currentGameMode,
        game: "mahjong",
        user: {
          nickname: currentUser.nickname,
          avatar: currentUser.avatar,
          friendId: currentUser.friendId
        }
      });
    };

    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.room !== currentRoomCode || msg.senderId === CLIENT_ID) return;

        if (msg.type === "JOIN_ROOM") {
          if (msg.user && msg.seat) {
            playerNames[msg.seat] = `${msg.user.avatar} ${msg.user.nickname}`;
            updateSeatsInfo();
          }
          if (isHost) {
            sendSocketMessage({
              type: "SYNC_GAME_STATE",
              wallDeck: wallDeck,
              doraTile: doraTile,
              mode: currentGameMode,
              turnSeat: currentTurnSeat,
              playerNames: playerNames
            });
          }
        } else if (msg.type === "SYNC_GAME_STATE" && !isHost) {
          wallDeck = msg.wallDeck;
          doraTile = msg.doraTile;
          currentGameMode = msg.mode;
          if (msg.playerNames) playerNames = msg.playerNames;
          updateDoraUI();
          updateSeatsInfo();
          if (myHand.length === 0) {
            myHand = wallDeck.splice(0, 13);
            sortMyHand();
          }
          applyTurn(msg.turnSeat);
        } else if (msg.type === "TURN_UPDATE") {
          applyTurn(msg.seat);
        } else if (msg.type === "DISCARD") {
          lastDiscarderSeat = msg.seat;
          addDiscardTile(msg.tile);
          evaluateDiscardForPlayer(msg.tile);
        } else if (msg.type === "MELD_CLAIMED") {
          removeLastDiscardFromPond();
          handleOpponentMeld(msg.seat, msg.meldTiles);
        } else if (msg.type === "RIICHI_DECLARED") {
          playerPoints[msg.seat] -= 1000;
          updateSeatsInfo();
          alert(`${playerNames[msg.seat]} menyatakan RIICHI!`);
        } else if (msg.type === "GAME_OVER") {
          removeLastDiscardFromPond();
          alert(`Game Selesai! Pemenang: ${playerNames[msg.winnerSeat]}`);
          clearInterval(turnTimerInterval);
        }
      } catch (e) {}
    };

    socket.onerror = () => {
      statusBar.innerText = "Mode Offline (Simulasi Lokal)";
    };
  } catch (err) {
    statusBar.innerText = "Mode Offline (Simulasi Lokal)";
  }
}

function updateSeatsInfo() {
  const labelBottom = document.getElementById("label-bottom");
  const labelRight = document.getElementById("label-right");
  const labelTop = document.getElementById("label-top");
  const labelLeft = document.getElementById("label-left");

  if (labelBottom) labelBottom.innerText = `${playerNames[0]} (${playerPoints[0]})`;
  if (labelRight) labelRight.innerText = `${playerNames[1]} (${playerPoints[1]})`;
  if (labelTop) labelTop.innerText = `${playerNames[2]} (${playerPoints[2]})`;
  if (labelLeft) labelLeft.innerText = `${playerNames[3]} (${playerPoints[3]})`;
}

function startTurnTimer() {
  clearInterval(turnTimerInterval);
  turnTimeRemaining = 15;
  const timerCount = document.getElementById("timer-count");
  if (timerCount) timerCount.innerText = turnTimeRemaining;

  turnTimerInterval = setInterval(() => {
    turnTimeRemaining--;
    if (timerCount) timerCount.innerText = turnTimeRemaining;

    if (turnTimeRemaining <= 0) {
      clearInterval(turnTimerInterval);
      if (currentTurnSeat === mySeatIndex) {
        discardTile(myHand.length - 1);
      }
    }
  }, 1000);
}

function applyTurn(seatIndex) {
  if (currentTurnSeat === seatIndex && isProcessingTurn) return;

  currentTurnSeat = seatIndex;
  isProcessingTurn = true;

  if (botActionTimer) {
    clearTimeout(botActionTimer);
    botActionTimer = null;
  }

  const seats = [
    document.getElementById("seat-bottom"),
    document.getElementById("seat-right"),
    document.getElementById("seat-top"),
    document.getElementById("seat-left")
  ];

  seats.forEach((seatEl, idx) => {
    if (!seatEl) return;
    if (idx === seatIndex) {
      seatEl.classList.add("active-turn");
    } else {
      seatEl.classList.remove("active-turn");
    }
  });

  startTurnTimer();

  const statusBar = document.getElementById("status-bar");
  if (currentTurnSeat === mySeatIndex) {
    if (statusBar) statusBar.innerText = "Giliran Anda: Sentuh untuk buang, atau geser untuk urutkan";
    drawTile();
    isProcessingTurn = false;
  } else {
    if (statusBar) statusBar.innerText = `Giliran ${playerNames[currentTurnSeat]}...`;
    if (isHost) {
      botActionTimer = setTimeout(() => {
        executeBotTurn(currentTurnSeat);
      }, 2500);
    }
  }
}

function moveToNextTurn(nextSeat) {
  applyTurn(nextSeat);
  sendSocketMessage({
    type: "TURN_UPDATE",
    seat: nextSeat
  });
}

function executeBotTurn(seatIndex) {
  const statusBar = document.getElementById("status-bar");
  if (wallDeck.length === 0) {
    if (statusBar) statusBar.innerText = "Game Selesai: Balok Habis";
    clearInterval(turnTimerInterval);
    return;
  }

  const drawn = wallDeck.pop();
  botHands[seatIndex].push(drawn);

  const discarded = botHands[seatIndex].pop();
  lastDiscardedTile = discarded;
  lastDiscarderSeat = seatIndex;
  addDiscardTile(discarded);

  const canPlayerClaim = evaluateDiscardForPlayer(discarded);

  botActionTimer = setTimeout(() => {
    isProcessingTurn = false;
    hideAssistNotification();
    if (isHost && checkOtherBotsClaim(seatIndex, discarded)) {
      return;
    }
    moveToNextTurn((seatIndex + 1) % 4);
  }, canPlayerClaim ? 5000 : 1800);
}

// Render Balok Tangan dengan Integrasi Drag and Drop (Mouse & Touch Jari)
function renderHand() {
  const lineHolder = document.getElementById("player-hand-tiles");
  const drawnSlot = document.getElementById("player-drawn-slot");
  if (!lineHolder) return;

  lineHolder.innerHTML = "";
  if (drawnSlot) drawnSlot.innerHTML = "";

  const mainCount = (myHand.length % 3 === 2) ? (myHand.length - 1) : myHand.length;

  for (let i = 0; i < mainCount; i++) {
    const tile = myHand[i];
    const tileEl = createInteractiveTileElement(tile, i);
    lineHolder.appendChild(tileEl);
  }

  if (myHand.length % 3 === 2 && drawnSlot) {
    const lastIdx = myHand.length - 1;
    const drawnTile = myHand[lastIdx];
    const drawnEl = createInteractiveTileElement(drawnTile, lastIdx);
    drawnSlot.appendChild(drawnEl);
  }
}

// Helper Pembuatan Balok Interaktif (Tap Buang vs Drag Urutkan)
function createInteractiveTileElement(tile, index) {
  const tileEl = document.createElement("div");
  tileEl.className = "tile";
  tileEl.setAttribute("data-index", index);
  tileEl.draggable = true;
  tileEl.innerHTML = getTileHTML(tile);

  // 1. DRAG AND DROP DESKTOP (HTML5 DRAG API)
  tileEl.addEventListener("dragstart", (e) => {
    draggedIndex = index;
    tileEl.classList.add("dragging");
    e.dataTransfer.setData("text/plain", index);
  });

  tileEl.addEventListener("dragend", () => {
    tileEl.classList.remove("dragging");
    document.querySelectorAll(".tile").forEach(el => el.classList.remove("drag-over"));
  });

  tileEl.addEventListener("dragover", (e) => {
    e.preventDefault();
    tileEl.classList.add("drag-over");
  });

  tileEl.addEventListener("dragleave", () => {
    tileEl.classList.remove("drag-over");
  });

  tileEl.addEventListener("drop", (e) => {
    e.preventDefault();
    tileEl.classList.remove("drag-over");
    const targetIdx = index;
    if (draggedIndex !== null && draggedIndex !== targetIdx) {
      swapHandTiles(draggedIndex, targetIdx);
    }
  });

  // 2. DRAG AND DROP SENTUHAN JARI DI HP (TOUCH EVENTS)
  tileEl.addEventListener("touchstart", (e) => {
    const touch = e.touches[0];
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;
    isTouchDragging = false;
    draggedIndex = index;
    activeDragElement = tileEl;
  }, { passive: true });

  tileEl.addEventListener("touchmove", (e) => {
    const touch = e.touches[0];
    const deltaX = Math.abs(touch.clientX - touchStartX);
    const deltaY = Math.abs(touch.clientY - touchStartY);

    // Jika jari bergeser lebih dari 8 pixel, ubah mode menjadi dragging
    if (deltaX > 8 || deltaY > 8) {
      isTouchDragging = true;
      tileEl.classList.add("dragging");

      // Cari elemen balok di bawah koordinat ujung jari saat ini
      const elemBelow = document.elementFromPoint(touch.clientX, touch.clientY);
      const targetTile = elemBelow ? elemBelow.closest(".tile") : null;

      document.querySelectorAll(".tile").forEach(el => el.classList.remove("drag-over"));
      if (targetTile && targetTile !== tileEl) {
        targetTile.classList.add("drag-over");
      }
    }
  }, { passive: true });

  tileEl.addEventListener("touchend", (e) => {
    if (isTouchDragging) {
      tileEl.classList.remove("dragging");
      const touch = e.changedTouches[0];
      const elemBelow = document.elementFromPoint(touch.clientX, touch.clientY);
      const targetTile = elemBelow ? elemBelow.closest(".tile") : null;

      document.querySelectorAll(".tile").forEach(el => el.classList.remove("drag-over"));

      if (targetTile && targetTile !== tileEl) {
        const targetIdx = parseInt(targetTile.getAttribute("data-index"), 10);
        if (!isNaN(targetIdx) && draggedIndex !== null) {
          swapHandTiles(draggedIndex, targetIdx);
        }
      }
    } else {
      // Jika tidak digeser (hanya ketukan biasa / tap), jalankan aksi buang
      if (currentTurnSeat === mySeatIndex) {
        discardTile(index);
      } else {
        alert("Bukan giliran Anda!");
      }
    }
    isTouchDragging = false;
    activeDragElement = null;
    draggedIndex = null;
  });

  // Klik mouse desktop biasa jika tidak di-drag
  tileEl.addEventListener("click", () => {
    if (!isTouchDragging && draggedIndex === null) {
      if (currentTurnSeat === mySeatIndex) {
        discardTile(index);
      } else {
        alert("Bukan giliran Anda!");
      }
    }
  });

  return tileEl;
}

// Logika Menukar Posisi Balok Secara Manual
function swapHandTiles(fromIdx, toIdx) {
  if (fromIdx < 0 || fromIdx >= myHand.length || toIdx < 0 || toIdx >= myHand.length) return;
  const temp = myHand[fromIdx];
  myHand[fromIdx] = myHand[toIdx];
  myHand[toIdx] = temp;
  renderHand();
}

function renderOpponents() {
  const holders = [
    document.getElementById("hand-top"),
    document.getElementById("hand-left"),
    document.getElementById("hand-right")
  ];

  holders.forEach((holder) => {
    if (!holder) return;
    holder.innerHTML = "";
    for (let i = 0; i < 13; i++) {
      const tileBack = document.createElement("div");
      tileBack.className = "tile-back-solitaire";
      holder.appendChild(tileBack);
    }
  });
}

function sortMyHand() {
  myHand.sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    return a.num - b.num;
  });
  renderHand();
}

function drawTile() {
  const statusBar = document.getElementById("status-bar");
  const btnHu = document.getElementById("btn-win");
  const btnRiichi = document.getElementById("btn-riichi");

  if (wallDeck.length === 0) {
    if (statusBar) statusBar.innerText = "Game Selesai: Balok Habis";
    clearInterval(turnTimerInterval);
    return;
  }

  const newTile = wallDeck.pop();
  myHand.push(newTile);
  renderHand();

  if (currentGameMode === "RIICHI" && !isRiichiDeclared && exposedMelds[0].length === 0) {
    if (checkTenpai(myHand) && btnRiichi) {
      if (assistLevel !== "INTERMEDIATE") {
        btnRiichi.classList.remove("hidden");
      }
    }
  }

  if (validateWin(myHand, true)) {
    if (assistLevel === "NEWBIE") {
      showAssistNotification("PELUANG TSUMO (HU)! Tangan Lengkap!");
      if (btnHu) btnHu.classList.remove("hidden");
    } else if (assistLevel === "BEGINNER") {
      if (btnHu) btnHu.classList.remove("hidden");
    }
    if (statusBar) statusBar.innerText = "HU! Tangan lengkap dan siap menang!";
  }
}

function discardTile(index) {
  const discarded = myHand.splice(index, 1)[0];
  lastDiscardedTile = discarded;
  lastDiscarderSeat = mySeatIndex;

  renderHand();
  addDiscardTile(discarded);
  hideActionButtons();
  hideAssistNotification();

  sendSocketMessage({
    type: "DISCARD",
    tile: discarded,
    seat: mySeatIndex
  });

  if (isHost && checkOtherBotsClaim(0, discarded)) {
    return;
  }

  moveToNextTurn((mySeatIndex + 1) % 4);
}

function addDiscardTile(tile) {
  const discardContainer = document.getElementById("discard-tiles");
  if (!discardContainer) return;

  const tileElement = document.createElement("div");
  tileElement.className = "tile discarded";
  tileElement.innerHTML = getTileHTML(tile);
  discardContainer.appendChild(tileElement);
  discardContainer.scrollTop = discardContainer.scrollHeight;
  lastDiscardElement = tileElement;
}

function removeLastDiscardFromPond() {
  if (lastDiscardElement && lastDiscardElement.parentNode) {
    lastDiscardElement.parentNode.removeChild(lastDiscardElement);
    lastDiscardElement = null;
  }
}

function evaluateDiscardForPlayer(discardedTile) {
  const btnPung = document.getElementById("btn-pung");
  const btnChow = document.getElementById("btn-chow");
  const btnKong = document.getElementById("btn-kong");
  const btnHu = document.getElementById("btn-win");
  const btnSkip = document.getElementById("btn-skip");

  let canPung = false;
  let canKong = false;
  let canChow = false;
  let canHu = false;

  const countSame = myHand.filter((t) => t.num === discardedTile.num && t.suit === discardedTile.suit).length;
  if (countSame >= 2) canPung = true;
  if (countSame === 3) canKong = true;

  const leftSeatIndex = (mySeatIndex + 3) % 4;
  if (lastDiscarderSeat === leftSeatIndex && discardedTile.suit !== "Honor") {
    const suit = discardedTile.suit;
    const n = discardedTile.num;
    const hasNum = (num) => myHand.some((t) => t.suit === suit && t.num === num);

    if ((hasNum(n - 2) && hasNum(n - 1)) || (hasNum(n - 1) && hasNum(n + 1)) || (hasNum(n + 1) && hasNum(n + 2))) {
      canChow = true;
    }
  }

  const testHand = [...myHand, discardedTile];
  if (validateWin(testHand, false)) {
    canHu = true;
  }

  const anyAvailable = canPung || canKong || canChow || canHu;

  if (assistLevel === "NEWBIE") {
    if (anyAvailable) {
      let notifyMsg = "Peluang: ";
      if (canHu) notifyMsg += "HU! ";
      if (canPung) notifyMsg += "PUNG ";
      if (canChow) notifyMsg += "CHOW ";
      if (canKong) notifyMsg += "KONG ";

      showAssistNotification(notifyMsg);
      if (canHu && btnHu) btnHu.classList.remove("hidden");
      if (canPung && btnPung) btnPung.classList.remove("hidden");
      if (canChow && btnChow) btnChow.classList.remove("hidden");
      if (canKong && btnKong) btnKong.classList.remove("hidden");
      if (btnSkip) btnSkip.classList.remove("hidden");
    }
  } else if (assistLevel === "BEGINNER") {
    hideAssistNotification();
    if (anyAvailable) {
      if (canHu && btnHu) btnHu.classList.remove("hidden");
      if (canPung && btnPung) btnPung.classList.remove("hidden");
      if (canChow && btnChow) btnChow.classList.remove("hidden");
      if (canKong && btnKong) btnKong.classList.remove("hidden");
      if (btnSkip) btnSkip.classList.remove("hidden");
    }
  } else if (assistLevel === "INTERMEDIATE") {
    hideAssistNotification();
    showIntermediateManualButtons();
  }

  return anyAvailable;
}

function showAssistNotification(text) {
  const banner = document.getElementById("assist-notify-banner");
  const textEl = document.getElementById("assist-notify-text");
  if (banner && textEl) {
    textEl.innerText = text;
    banner.classList.remove("hidden");
  }
}

function hideAssistNotification() {
  const banner = document.getElementById("assist-notify-banner");
  if (banner) banner.classList.add("hidden");
}

function showIntermediateManualButtons() {
  const btnPung = document.getElementById("btn-pung");
  const btnChow = document.getElementById("btn-chow");
  const btnKong = document.getElementById("btn-kong");
  const btnHu = document.getElementById("btn-win");
  const btnSkip = document.getElementById("btn-skip");

  if (btnPung) btnPung.classList.remove("hidden");
  if (btnChow) btnChow.classList.remove("hidden");
  if (btnKong) btnKong.classList.remove("hidden");
  if (btnHu) btnHu.classList.remove("hidden");
  if (btnSkip) btnSkip.classList.remove("hidden");
}

function hideActionButtons() {
  if (assistLevel === "INTERMEDIATE") return;

  const btnPung = document.getElementById("btn-pung");
  const btnChow = document.getElementById("btn-chow");
  const btnKong = document.getElementById("btn-kong");
  const btnHu = document.getElementById("btn-win");
  const btnRiichi = document.getElementById("btn-riichi");
  const btnSkip = document.getElementById("btn-skip");

  if (btnPung) btnPung.classList.add("hidden");
  if (btnChow) btnChow.classList.add("hidden");
  if (btnKong) btnKong.classList.add("hidden");
  if (btnHu) btnHu.classList.add("hidden");
  if (btnRiichi) btnRiichi.classList.add("hidden");
  if (btnSkip) btnSkip.classList.add("hidden");
}

window.skipClaimAction = function () {
  hideAssistNotification();
  hideActionButtons();
  const statusBar = document.getElementById("status-bar");
  if (statusBar) statusBar.innerText = "Anda memilih MELEWATKAN balok ini.";
};

function claimAction(actionName) {
  if (!lastDiscardedTile && actionName !== "RIICHI") {
    alert("Belum ada balok buangan yang bisa diklaim!");
    return;
  }

  if (actionName === "RIICHI") {
    if (!checkTenpai(myHand)) {
      alert("Gagal Riichi: Tangan belum Tenpai!");
      return;
    }
    isRiichiDeclared = true;
    playerPoints[0] -= 1000;
    updateSeatsInfo();
    hideActionButtons();
    alert("RIICHI aktif! Taruhan 1000 poin dipasang.");
    sendSocketMessage({
      type: "RIICHI_DECLARED",
      seat: mySeatIndex
    });
    return;
  }

  if (actionName === "HU") {
    const testHand = [...myHand, lastDiscardedTile];
    if (!validateWin(testHand, false)) {
      alert("CHOMBO! Anda salah klaim HU. Belum memenuhi syarat menang!");
      return;
    }

    removeLastDiscardFromPond();
    hideAssistNotification();
    alert("SELAMAT! ANDA MENANG (HU)!");
    clearInterval(turnTimerInterval);
    sendSocketMessage({
      type: "GAME_OVER",
      winnerSeat: mySeatIndex
    });
    return;
  }

  if (actionName === "PUNG") {
    const matching = myHand.filter((tile) => tile.num === lastDiscardedTile.num && tile.suit === lastDiscardedTile.suit);
    if (matching.length < 2) {
      alert("Gagal PUNG: Tidak ada 2 balok kembar yang cocok!");
      return;
    }

    removeLastDiscardFromPond();
    hideAssistNotification();

    let removed = 0;
    const claimedTiles = [lastDiscardedTile];
    myHand = myHand.filter((tile) => {
      if (tile.num === lastDiscardedTile.num && tile.suit === lastDiscardedTile.suit && removed < 2) {
        removed++;
        claimedTiles.push(tile);
        return false;
      }
      return true;
    });

    addExposedMeld(0, claimedTiles);
    renderHand();
    hideActionButtons();

    sendSocketMessage({
      type: "MELD_CLAIMED",
      seat: mySeatIndex,
      meldTiles: claimedTiles
    });

    isProcessingTurn = false;
    currentTurnSeat = mySeatIndex;
    startTurnTimer();
    const statusBar = document.getElementById("status-bar");
    if (statusBar) statusBar.innerText = "PUNG berhasil! Silakan buang 1 balok.";
  }

  if (actionName === "CHOW") {
    const leftSeatIndex = (mySeatIndex + 3) % 4;
    if (lastDiscarderSeat !== leftSeatIndex) {
      alert("Gagal CHOW: Hanya bisa klaim dari pemain sebelah kiri!");
      return;
    }

    const suit = lastDiscardedTile.suit;
    const n = lastDiscardedTile.num;
    let t1 = null, t2 = null;

    if (myHand.some(t => t.suit === suit && t.num === n - 1) && myHand.some(t => t.suit === suit && t.num === n + 1)) {
      t1 = myHand.find(t => t.suit === suit && t.num === n - 1);
      t2 = myHand.find(t => t.suit === suit && t.num === n + 1);
    } else if (myHand.some(t => t.suit === suit && t.num === n + 1) && myHand.some(t => t.suit === suit && t.num === n + 2)) {
      t1 = myHand.find(t => t.suit === suit && t.num === n + 1);
      t2 = myHand.find(t => t.suit === suit && t.num === n + 2);
    } else if (myHand.some(t => t.suit === suit && t.num === n - 2) && myHand.some(t => t.suit === suit && t.num === n - 1)) {
      t1 = myHand.find(t => t.suit === suit && t.num === n - 2);
      t2 = myHand.find(t => t.suit === suit && t.num === n - 1);
    }

    if (!t1 || !t2) {
      alert("Gagal CHOW: Tidak ada balok urutan yang cocok!");
      return;
    }

    removeLastDiscardFromPond();
    hideAssistNotification();

    myHand = myHand.filter(t => t !== t1 && t !== t2);
    const claimedMeld = [t1, lastDiscardedTile, t2];
    addExposedMeld(0, claimedMeld);
    renderHand();
    hideActionButtons();

    sendSocketMessage({
      type: "MELD_CLAIMED",
      seat: mySeatIndex,
      meldTiles: claimedMeld
    });

    isProcessingTurn = false;
    currentTurnSeat = mySeatIndex;
    startTurnTimer();
    const statusBar = document.getElementById("status-bar");
    if (statusBar) statusBar.innerText = "CHOW berhasil! Silakan buang 1 balok.";
  }

  if (actionName === "KONG") {
    const matching = myHand.filter((tile) => tile.num === lastDiscardedTile.num && tile.suit === lastDiscardedTile.suit);
    if (matching.length < 3) {
      alert("Gagal KONG: Butuh 3 balok kembar di tangan!");
      return;
    }

    removeLastDiscardFromPond();
    hideAssistNotification();

    let removed = 0;
    const claimedTiles = [lastDiscardedTile];
    myHand = myHand.filter((tile) => {
      if (tile.num === lastDiscardedTile.num && tile.suit === lastDiscardedTile.suit && removed < 3) {
        removed++;
        claimedTiles.push(tile);
        return false;
      }
      return true;
    });

    addExposedMeld(0, claimedTiles);
    drawTile();
    renderHand();
    hideActionButtons();

    sendSocketMessage({
      type: "MELD_CLAIMED",
      seat: mySeatIndex,
      meldTiles: claimedTiles
    });
  }
}

function checkOtherBotsClaim(discarderSeat, discardedTile) {
  for (let seat = 1; seat <= 3; seat++) {
    if (seat === discarderSeat) continue;

    const testHand = [...botHands[seat], discardedTile];
    if (validateWin(testHand, false)) {
      removeLastDiscardFromPond();
      alert(`${playerNames[seat]} mengklaim HU!`);
      sendSocketMessage({
        type: "GAME_OVER",
        winnerSeat: seat
      });
      return true;
    }

    const matching = botHands[seat].filter(t => t.num === discardedTile.num && t.suit === discardedTile.suit);
    if (matching.length >= 2) {
      removeLastDiscardFromPond();
      let removed = 0;
      botHands[seat] = botHands[seat].filter(t => {
        if (t.num === discardedTile.num && t.suit === discardedTile.suit && removed < 2) {
          removed++;
          return false;
        }
        return true;
      });

      const claimedMeld = [discardedTile, matching[0], matching[1]];
      addExposedMeld(seat, claimedMeld);
      sendSocketMessage({
        type: "MELD_CLAIMED",
        seat: seat,
        meldTiles: claimedMeld
      });

      moveToNextTurn(seat);
      return true;
    }
  }
  return false;
}

function addExposedMeld(seatIndex, tiles) {
  exposedMelds[seatIndex].push(tiles);
  const containerIds = ["melds-bottom", "melds-right", "melds-top", "melds-left"];
  const targetEl = document.getElementById(containerIds[seatIndex]);
  if (!targetEl) return;

  const groupEl = document.createElement("div");
  groupEl.className = "meld-group";
  tiles.forEach((t) => {
    const tileDiv = document.createElement("div");
    tileDiv.className = "tile-meld";
    tileDiv.innerHTML = getTileHTML(t);
    groupEl.appendChild(tileDiv);
  });
  targetEl.appendChild(groupEl);
}

function handleOpponentMeld(seatIndex, meldTiles) {
  addExposedMeld(seatIndex, meldTiles);
}

function validateWin(handTiles, isSelfDrawn) {
  if (!checkBasicMahjongStructure(handTiles)) return false;
  if (currentGameMode === "HK") return true;
  return checkRiichiYaku(handTiles, isSelfDrawn);
}

function checkBasicMahjongStructure(handTiles) {
  const counts = {};
  handTiles.forEach((t) => {
    const key = `${t.suit}_${t.num}`;
    counts[key] = (counts[key] || 0) + 1;
  });

  const uniqueKeys = Object.keys(counts);
  for (const pairKey of uniqueKeys) {
    if (counts[pairKey] >= 2) {
      counts[pairKey] -= 2;
      if (canFormMelds(counts)) {
        counts[pairKey] += 2;
        return true;
      }
      counts[pairKey] += 2;
    }
  }
  return false;
}

function canFormMelds(counts) {
  const keys = Object.keys(counts).filter((k) => counts[k] > 0);
  if (keys.length === 0) return true;

  const firstKey = keys[0];
  const [suit, numStr] = firstKey.split("_");
  const num = parseInt(numStr, 10);

  if (counts[firstKey] >= 3) {
    counts[firstKey] -= 3;
    if (canFormMelds(counts)) {
      counts[firstKey] += 3;
      return true;
    }
    counts[firstKey] += 3;
  }

  if (suit !== "Honor" && num <= 7) {
    const secondKey = `${suit}_${num + 1}`;
    const thirdKey = `${suit}_${num + 2}`;

    if (counts[secondKey] > 0 && counts[thirdKey] > 0) {
      counts[firstKey]--;
      counts[secondKey]--;
      counts[thirdKey]--;

      if (canFormMelds(counts)) {
        counts[firstKey]++;
        counts[secondKey]++;
        counts[thirdKey]++;
        return true;
      }

      counts[firstKey]++;
      counts[secondKey]++;
      counts[thirdKey]++;
    }
  }

  return false;
}

function checkRiichiYaku(handTiles, isSelfDrawn) {
  if (isRiichiDeclared) return true;
  if (isSelfDrawn && exposedMelds[0].length === 0) return true;

  const isTanyao = handTiles.every((t) => t.suit !== "Honor" && t.num >= 2 && t.num <= 8);
  if (isTanyao) return true;

  const counts = {};
  handTiles.forEach((t) => {
    const key = `${t.suit}_${t.num}`;
    counts[key] = (counts[key] || 0) + 1;
  });
  if (counts["Honor_5"] >= 3 || counts["Honor_6"] >= 3 || counts["Honor_7"] >= 3) {
    return true;
  }

  return false;
}

function checkTenpai(handTiles) {
  if (handTiles.length !== 14) return false;
  for (let i = 0; i < handTiles.length; i++) {
    const test13 = [...handTiles];
    test13.splice(i, 1);
    const suits = ["Wan", "Pin", "Sou"];
    for (const s of suits) {
      for (let n = 1; n <= 9; n++) {
        const dummyTile = { suit: s, num: n };
        if (checkBasicMahjongStructure([...test13, dummyTile])) {
          return true;
        }
      }
    }
  }
  return false;
}

// Inisialisasi DOM
document.addEventListener("DOMContentLoaded", () => {
  checkAutoLogin();

  const btnCreate = document.getElementById("btn-create-room");
  const btnJoin = document.getElementById("btn-join-room");
  const btnSort = document.getElementById("btn-sort");
  const btnRiichi = document.getElementById("btn-riichi");
  const btnChow = document.getElementById("btn-chow");
  const btnPung = document.getElementById("btn-pung");
  const btnKong = document.getElementById("btn-kong");
  const btnWin = document.getElementById("btn-win");

  if (btnCreate) btnCreate.addEventListener("click", startCreateRoom);
  if (btnJoin) btnJoin.addEventListener("click", startJoinRoom);
  if (btnSort) btnSort.addEventListener("click", sortMyHand);
  if (btnRiichi) btnRiichi.addEventListener("click", () => claimAction("RIICHI"));
  if (btnChow) btnChow.addEventListener("click", () => claimAction("CHOW"));
  if (btnPung) btnPung.addEventListener("click", () => claimAction("PUNG"));
  if (btnKong) btnKong.addEventListener("click", () => claimAction("KONG"));
  if (btnWin) btnWin.addEventListener("click", () => claimAction("HU"));
});
