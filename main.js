// Konfigurasi WebSocket
const WS_SERVER_URL = "wss://mahjong-pvp-server.owning.workers.dev/ws";
const CLIENT_ID = "client_" + Math.random().toString(36).substring(2, 9);

// Elemen Antarmuka
const statusBar = document.getElementById("status-bar");
const timerCount = document.getElementById("timer-count");
const handContainer = document.getElementById("player-hand");
const discardContainer = document.getElementById("discard-tiles");
const handTop = document.getElementById("hand-top");
const handLeft = document.getElementById("hand-left");
const handRight = document.getElementById("hand-right");
const btnPung = document.getElementById("btn-pung");
const btnHu = document.getElementById("btn-win");

// Elemen Kursi
const seats = [
  document.getElementById("seat-bottom"),
  document.getElementById("seat-right"),
  document.getElementById("seat-top"),
  document.getElementById("seat-left")
];

// State Permainan
let socket = null;
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

// Fitur Urutkan Balok Otomatis (Sortir)
function sortMyHand() {
  myHand.sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    return a.num - b.num;
  });
  renderHand();
}

// Algoritma Validasi Kemenangan (4 Melds + 1 Pair = 14 Balok)
function checkMahjongWin(handTiles) {
  if (handTiles.length % 3 !== 2) return false;

  // Kelompokkan balok berdasarkan representasi string unik
  const counts = {};
  handTiles.forEach(t => {
    const key = `${t.suit}_${t.num}`;
    counts[key] = (counts[key] || 0) + 1;
  });

  // Cari pasangan mata (Pair / 2 balok sama)
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
  const keys = Object.keys(counts).filter(k => counts[k] > 0);
  if (keys.length === 0) return true;

  const firstKey = keys[0];
  const [suit, numStr] = firstKey.split("_");
  const num = parseInt(numStr, 10);

  // Opsi 1: Coba bentuk Triplet (3 Balok Kembar / Pung)
  if (counts[firstKey] >= 3) {
    counts[firstKey] -= 3;
    if (canFormMelds(counts)) {
      counts[firstKey] += 3;
      return true;
    }
    counts[firstKey] += 3;
  }

  // Opsi 2: Coba bentuk Sequence (Urutan 3 Angka / Chow: num, num+1, num+2)
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

// Inisialisasi WebSocket
function initNetwork() {
  try {
    socket = new WebSocket(WS_SERVER_URL);

    socket.onopen = () => {
      statusBar.innerText = "Terkoneksi ke Meja Cloudflare";
    };

    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.senderId === CLIENT_ID) return;

        if (msg.type === "TURN_UPDATE") {
          applyTurn(msg.seat);
        } else if (msg.type === "DISCARD") {
          addDiscardTile(msg.tile);
          checkPossibleActions(msg.tile);
        } else if (msg.type === "GAME_OVER") {
          alert(`Game Selesai! Pemenang: Pemain ${msg.winnerSeat + 1}`);
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

function startTurnTimer() {
  clearInterval(turnTimerInterval);
  turnTimeRemaining = 15;
  timerCount.innerText = turnTimeRemaining;

  turnTimerInterval = setInterval(() => {
    turnTimeRemaining--;
    timerCount.innerText = turnTimeRemaining;

    if (turnTimeRemaining <= 0) {
      clearInterval(turnTimerInterval);
      if (currentTurnSeat === 0) {
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

  if (currentTurnSeat === 0) {
    statusBar.innerText = "Giliran Anda: Pilih 1 balok untuk dibuang";
    drawTile();
    isProcessingTurn = false;
  } else {
    statusBar.innerText = `Menunggu Pemain ${currentTurnSeat + 1} berpikir...`;
    botActionTimer = setTimeout(() => {
      executeBotTurn(currentTurnSeat);
    }, 2500);
  }
}

function moveToNextTurn(nextSeat) {
  applyTurn(nextSeat);
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: "TURN_UPDATE",
      seat: nextSeat,
      senderId: CLIENT_ID
    }));
  }
}

function executeBotTurn(seatIndex) {
  if (wallDeck.length === 0) {
    statusBar.innerText = "Game Selesai: Balok Habis (Draw)";
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

function renderHand() {
  handContainer.innerHTML = "";
  myHand.forEach((tile, index) => {
    const tileElement = document.createElement("div");
    tileElement.className = "tile";
    tileElement.innerText = tile.display;
    tileElement.onclick = () => {
      if (currentTurnSeat === 0) {
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

function drawTile() {
  if (wallDeck.length === 0) {
    statusBar.innerText = "Game Selesai: Balok Habis (Draw)";
    clearInterval(turnTimerInterval);
    return;
  }
  const newTile = wallDeck.pop();
  myHand.push(newTile);
  renderHand();

  // Evaluasi kemenangan Tsumo (menang dari tarikan sendiri)
  if (checkMahjongWin(myHand)) {
    btnHu.classList.remove("hidden");
    statusBar.innerText = "HU! Tangan Anda lengkap dan menang!";
  }
}

function discardTile(index) {
  const discarded = myHand.splice(index, 1)[0];
  lastDiscardedTile = discarded;

  renderHand();
  addDiscardTile(discarded);
  hideActionButtons();

  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: "DISCARD",
      tile: discarded,
      seat: 0,
      senderId: CLIENT_ID
    }));
  }

  moveToNextTurn(1);
}

function addDiscardTile(tile) {
  const tileElement = document.createElement("div");
  tileElement.className = "tile discarded";
  tileElement.innerText = tile.display || tile;
  discardContainer.appendChild(tileElement);
}

function checkPossibleActions(discardedTile) {
  // 1. Cek PUNG (2 balok sama di tangan)
  const countSame = myHand.filter((t) => t.display === discardedTile.display).length;
  if (countSame >= 2) {
    btnPung.classList.remove("hidden");
  }

  // 2. Cek RON (Menang dari buangan lawan)
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
    alert("SELAMAT! ANDA MENANG (HU)! Permainan Berakhir.");
    clearInterval(turnTimerInterval);

    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: "GAME_OVER",
        winnerSeat: 0,
        senderId: CLIENT_ID
      }));
    }
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
    alert(`Berhasil PUNG balok ${lastDiscardedTile.display}!`);
    hideActionButtons();
    moveToNextTurn(0);
  }
}

function startNewGame() {
  wallDeck = createFullDeck();
  myHand = wallDeck.splice(0, 13);
  sortMyHand();
  renderOpponents();
  initNetwork();
  moveToNextTurn(0);
}

startNewGame();
