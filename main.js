// Konfigurasi WebSocket
const WS_SERVER_URL = "wss://mahjong-pvp-server.owning.workers.dev/ws";

// Generate ID unik untuk sesi lokal ini
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

// Elemen Kursi
const seats = [
  document.getElementById("seat-bottom"), // Kursi 0 (Anda)
  document.getElementById("seat-right"),  // Kursi 1 (Kanan)
  document.getElementById("seat-top"),    // Kursi 2 (Atas / Seberang)
  document.getElementById("seat-left")    // Kursi 3 (Kiri)
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
  { name: "Wan", symbol: "🀇", count: 9 },
  { name: "Pin", symbol: "🀙", count: 9 },
  { name: "Sou", symbol: "🀐", count: 9 }
];
const HONORS = [
  { name: "Dong", symbol: "🀀" },
  { name: "Nan", symbol: "🀁" },
  { name: "Xi", symbol: "🀂" },
  { name: "Bei", symbol: "🀃" },
  { name: "Zhong", symbol: "🀄" },
  { name: "Fa", symbol: "🀅" },
  { name: "Bai", symbol: "🀆" }
];

function createFullDeck() {
  const deck = [];
  SUITS.forEach((suit) => {
    for (let num = 1; num <= suit.count; num++) {
      for (let i = 0; i < 4; i++) {
        deck.push({
          id: `${num}_${suit.name}_${i}`,
          label: `${num} ${suit.name}`,
          display: `${suit.symbol} ${num}${suit.name[0]}`
        });
      }
    }
  });

  HONORS.forEach((honor, hIdx) => {
    for (let i = 0; i < 4; i++) {
      deck.push({
        id: `honor_${hIdx}_${i}`,
        label: honor.name,
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

// Jaringan WebSocket dengan Filter ID Sendiri
function initNetwork() {
  try {
    socket = new WebSocket(WS_SERVER_URL);

    socket.onopen = () => {
      statusBar.innerText = "Terkoneksi ke Meja Cloudflare";
    };

    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        // Abaikan pesan pantulan dari diri sendiri
        if (msg.senderId === CLIENT_ID) return;

        if (msg.type === "TURN_UPDATE") {
          applyTurn(msg.seat);
        } else if (msg.type === "DISCARD") {
          addDiscardTile(msg.tile);
          checkPossibleActions(msg.tile);
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

// Timer Giliran
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

// Eksekusi Giliran
function applyTurn(seatIndex) {
  // Cegah pemanggilan berulang untuk giliran yang sama
  if (currentTurnSeat === seatIndex && isProcessingTurn) return;

  currentTurnSeat = seatIndex;
  isProcessingTurn = true;

  // Hentikan timer bot sebelumnya
  if (botActionTimer) {
    clearTimeout(botActionTimer);
    botActionTimer = null;
  }

  // Update visual sorotan meja
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
    
    // Jeda konsisten 2.5 detik untuk bot (termasuk pemain seberang)
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

  // Bot mengambil dan membuang 1 balok
  const discarded = wallDeck.pop();
  lastDiscardedTile = discarded;
  addDiscardTile(discarded);
  checkPossibleActions(discarded);

  // Berikan jeda 1.5 detik setelah kartu ditaruh sebelum giliran berganti ke pemain berikutnya
  botActionTimer = setTimeout(() => {
    isProcessingTurn = false;
    const nextSeat = (seatIndex + 1) % 4;
    moveToNextTurn(nextSeat);
  }, 1500);
}

// Render Balok
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
  const holders = [handTop, handLeft, handRight];
  holders.forEach((holder) => {
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

  // Lanjut ke Pemain 2 (Kanan / Kursi 1)
  moveToNextTurn(1);
}

function addDiscardTile(tile) {
  const tileElement = document.createElement("div");
  tileElement.className = "tile discarded";
  tileElement.innerText = tile.display || tile;
  discardContainer.appendChild(tileElement);
}

function checkPossibleActions(discardedTile) {
  const countSame = myHand.filter((t) => t.display === discardedTile.display).length;
  if (countSame >= 2 && btnPung) {
    btnPung.style.display = "inline-block";
    btnPung.style.backgroundColor = "#27ae60";
  }
}

function hideActionButtons() {
  if (btnPung) {
    btnPung.style.backgroundColor = "";
  }
}

function claimAction(actionName) {
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
  } else {
    alert(`Aksi: ${actionName}`);
  }
}

function startNewGame() {
  wallDeck = createFullDeck();
  myHand = wallDeck.splice(0, 13);
  renderHand();
  renderOpponents();
  initNetwork();
  moveToNextTurn(0);
}

startNewGame();
