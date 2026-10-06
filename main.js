// Konfigurasi WebSocket
const WS_SERVER_URL = "wss://mahjong-pvp-server.owning.workers.dev/ws";
const CLIENT_ID = "client_" + Math.random().toString(36).substring(2, 9);

// Elemen Lobi & Room
const lobbyScreen = document.getElementById("lobby-screen");
const gameTable = document.getElementById("game-table");
const roomBadge = document.getElementById("room-badge");
const inputRoomCode = document.getElementById("input-room-code");

// Elemen Antarmuka Meja
const statusBar = document.getElementById("status-bar");
const timerCount = document.getElementById("timer-count");
const handContainer = document.getElementById("player-hand");
const discardContainer = document.getElementById("discard-tiles");
const handTop = document.getElementById("hand-top");
const handLeft = document.getElementById("hand-left");
const handRight = document.getElementById("hand-right");
const labelTop = document.getElementById("label-top");
const labelLeft = document.getElementById("label-left");
const labelRight = document.getElementById("label-right");
const labelBottom = document.getElementById("label-bottom");
const btnPung = document.getElementById("btn-pung");
const btnHu = document.getElementById("btn-win");

// Elemen Kursi
const seats = [
  document.getElementById("seat-bottom"),
  document.getElementById("seat-right"),
  document.getElementById("seat-top"),
  document.getElementById("seat-left")
];

// State Ruangan & Jaringan
let socket = null;
let currentRoomCode = null;
let mySeatIndex = 0; // 0 = Anda
let isHost = false;
let roomMembers = []; // Sesi yang bergabung di ruangan

// State Permainan
let wallDeck = [];
let myHand = [];
let currentTurnSeat = -1;
let turnTimeRemaining = 15;
let turnTimerInterval = null;
let botActionTimer = null;
let isProcessingTurn = false;
let lastDiscardedTile = null;

// Koleksi Balok Mahjong
const SUITS = [
  { name: "Wan", symbol: "🀇", order: 1, count: 9 },
  { name: "Pin", symbol: "🀙", order: 2, count: 9 },
  { name: "Sou", symbol: "🀐", order: 3, count: 9 }
];
const HONORS = [
  { name: "Dong", symbol: "🀀", val: 1 },
  { name: "Nan", symbol: "🀁", val: 2 },
  { name: "Xi", symbol: "🀂", val: 3 },
  { name: "Bei", symbol: "🀃", val: 4 },
  { name: "Zhong", symbol: "🀄", val: 5 },
  { name: "Fa", symbol: "🀅", val: 6 },
  { name: "Bai", symbol: "🀆", val: 7 }
];

function createFullDeck() {
  const deck = [];
  SUITS.forEach((suit) => {
    for (let num = 1; num <= suit.count; num++) {
      for (let i = 0; i < 4; i++) {
        deck.push({
          id: `${num}_${suit.name}_${i}`,
          suit: suit.name,
          num: num,
          order: suit.order,
          display: `${suit.symbol} ${num}${suit.name[0]}`
        });
      }
    }
  });

  HONORS.forEach((honor) => {
    for (let i = 0; i < 4; i++) {
      deck.push({
        id: `honor_${honor.name}_${i}`,
        suit: "Honor",
        num: honor.val,
        order: 4,
        display: `${honor.symbol} ${honor.name}`
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

// 1. Logika Lobi & Pembuatan Ruangan
function createRoom() {
  // Buat kode 4 angka acak
  const code = Math.floor(1000 + Math.random() * 9000).toString();
  isHost = true;
  mySeatIndex = 0;
  enterRoom(code);
}

function joinRoomByInput() {
  const code = inputRoomCode.value.trim().toUpperCase();
  if (code.length < 4) {
    alert("Masukkan 4 digit kode ruangan yang valid!");
    return;
  }
  isHost = false;
  enterRoom(code);
}

function enterRoom(code) {
  currentRoomCode = code;
  roomBadge.innerText = `ROOM: ${code}`;
  lobbyScreen.classList.add("hidden");
  gameTable.classList.remove("hidden");

  initNetwork();

  if (isHost) {
    // Host mengocok balok dan menyiapkannya untuk ruangan
    wallDeck = createFullDeck();
    myHand = wallDeck.splice(0, 13);
    sortMyHand();
    renderOpponents();
    updateSeatsInfo();

    // Beri waktu 1 detik lalu mulai giliran pertama
    setTimeout(() => {
      moveToNextTurn(0);
    }, 1000);
  } else {
    // Tamu menunggu sinkronisasi balok dari Host
    statusBar.innerText = `Bergabung ke ROOM ${code}. Menunggu Host...`;
    renderOpponents();
  }
}

// 2. Jaringan WebSocket Khusus Ruangan
function initNetwork() {
  try {
    socket = new WebSocket(WS_SERVER_URL);

    socket.onopen = () => {
      // Daftarkan diri ke ruangan ini
      sendSocketMessage({
        type: "JOIN_ROOM",
        room: currentRoomCode,
        isHost: isHost
      });
    };

    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        // Abaikan pesan jika bukan dari ruangan yang sama atau dari diri sendiri
        if (msg.room !== currentRoomCode || msg.senderId === CLIENT_ID) return;

        if (msg.type === "JOIN_ROOM") {
          // Jika ada pemain baru masuk dan kita adalah Host, bagikan sisa balok
          if (isHost) {
            sendSocketMessage({
              type: "SYNC_GAME_STATE",
              wallDeck: wallDeck,
              turnSeat: currentTurnSeat
            });
          }
        } else if (msg.type === "SYNC_GAME_STATE" && !isHost) {
          // Tamu menerima balok yang seragam
          wallDeck = msg.wallDeck;
          if (myHand.length === 0) {
            myHand = wallDeck.splice(0, 13);
            sortMyHand();
          }
          applyTurn(msg.turnSeat);
        } else if (msg.type === "TURN_UPDATE") {
          applyTurn(msg.seat);
        } else if (msg.type === "DISCARD") {
          addDiscardTile(msg.tile);
          checkPossibleActions(msg.tile);
        } else if (msg.type === "GAME_OVER") {
          alert(`Game Selesai! Pemenang: Kursi ${msg.winnerSeat + 1}`);
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

function sendSocketMessage(payload) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    payload.room = currentRoomCode;
    payload.senderId = CLIENT_ID;
    socket.send(JSON.stringify(payload));
  }
}

function updateSeatsInfo() {
  labelBottom.innerText = `Anda (Kursi 1 / Host)`;
  labelRight.innerText = "P2 (Bot/Pemain)";
  labelTop.innerText = "P3 (Bot/Pemain)";
  labelLeft.innerText = "P4 (Bot/Pemain)";
}

// 3. Manajemen Timer & Giliran
function startTurnTimer() {
  clearInterval(turnTimerInterval);
  turnTimeRemaining = 15;
  timerCount.innerText = turnTimeRemaining;

  turnTimerInterval = setInterval(() => {
    turnTimeRemaining--;
    timerCount.innerText = turnTimeRemaining;

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

  seats.forEach((seatEl, idx) => {
    if (idx === seatIndex) {
      seatEl.classList.add("active-turn");
    } else {
      seatEl.classList.remove("active-turn");
    }
  });

  startTurnTimer();

  if (currentTurnSeat === mySeatIndex) {
    statusBar.innerText = "Giliran Anda: Sentuh balok untuk buang";
    drawTile();
    isProcessingTurn = false;
  } else {
    statusBar.innerText = `Giliran Kursi ${currentTurnSeat + 1}...`;
    // Jika kursi lain belum ada pemain asli, Host menjalankan giliran bot
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
  if (wallDeck.length === 0) {
    statusBar.innerText = "Game Selesai: Balok Habis";
    clearInterval(turnTimerInterval);
    return;
  }

  const discarded = wallDeck.pop();
  lastDiscardedTile = discarded;
  addDiscardTile(discarded);
  checkPossibleActions(discarded);

  botActionTimer = setTimeout(() => {
    isProcessingTurn = false;
    moveToNextTurn((seatIndex + 1) % 4);
  }, 1500);
}

// 4. Render Balok & Validasi
function renderHand() {
  handContainer.innerHTML = "";
  myHand.forEach((tile, index) => {
    const tileElement = document.createElement("div");
    tileElement.className = "tile";
    tileElement.innerText = tile.display;
    tileElement.onclick = () => {
      if (currentTurnSeat === mySeatIndex) {
        discardTile(index);
      } else {
        alert("Bukan giliran Anda!");
      }
    };
    handContainer.appendChild(tileElement);
  });
}

function renderOpponents() {
  [handTop, handLeft, handRight].forEach((holder) => {
    holder.innerHTML = "";
    for (let i = 0; i < 13; i++) {
      const tileBack = document.createElement("div");
      tileBack.className = "tile-back";
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
  if (wallDeck.length === 0) {
    statusBar.innerText = "Game Selesai: Balok Habis";
    clearInterval(turnTimerInterval);
    return;
  }
  const newTile = wallDeck.pop();
  myHand.push(newTile);
  renderHand();

  if (checkMahjongWin(myHand)) {
    btnHu.classList.remove("hidden");
    statusBar.innerText = "HU! Tangan lengkap dan menang!";
  }
}

function discardTile(index) {
  const discarded = myHand.splice(index, 1)[0];
  lastDiscardedTile = discarded;

  renderHand();
  addDiscardTile(discarded);
  hideActionButtons();

  sendSocketMessage({
    type: "DISCARD",
    tile: discarded,
    seat: mySeatIndex
  });

  moveToNextTurn((mySeatIndex + 1) % 4);
}

function addDiscardTile(tile) {
  const tileElement = document.createElement("div");
  tileElement.className = "tile discarded";
  tileElement.innerText = tile.display || tile;
  discardContainer.appendChild(tileElement);
  discardContainer.scrollTop = discardContainer.scrollHeight;
}

function checkPossibleActions(discardedTile) {
  const countSame = myHand.filter((t) => t.display === discardedTile.display).length;
  if (countSame >= 2) {
    btnPung.classList.remove("hidden");
  }

  const testHand = [...myHand, discardedTile];
  if (checkMahjongWin(testHand)) {
    btnHu.classList.remove("hidden");
  }
}

function hideActionButtons() {
  btnPung.classList.add("hidden");
  btnHu.classList.add("hidden");
}

function claimAction(actionName) {
  if (actionName === "HU") {
    alert("SELAMAT! ANDA MENANG (HU)!");
    clearInterval(turnTimerInterval);

    sendSocketMessage({
      type: "GAME_OVER",
      winnerSeat: mySeatIndex
    });
    return;
  }

  if (actionName === "PUNG" && lastDiscardedTile) {
    let removed = 0;
    myHand = myHand.filter((tile) => {
      if (tile.display === lastDiscardedTile.display && removed < 2) {
        removed++;
        return false;
      }
      return true;
    });

    renderHand();
    alert(`Berhasil PUNG ${lastDiscardedTile.display}!`);
    hideActionButtons();
    moveToNextTurn(mySeatIndex);
  }
}

// Algoritma Validator Kemenangan
function checkMahjongWin(handTiles) {
  if (handTiles.length % 3 !== 2) return false;

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
