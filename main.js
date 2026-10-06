// Konfigurasi WebSocket
const WS_SERVER_URL = "wss://mahjong-pvp-server.owning.workers.dev/ws";

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
  document.getElementById("seat-top"),    // Kursi 2 (Atas)
  document.getElementById("seat-left")    // Kursi 3 (Kiri)
];

// State Permainan
let socket = null;
let wallDeck = [];
let myHand = [];
let currentTurnSeat = -1;
let turnTimeRemaining = 15;
let turnTimerInterval = null;
let botActionTimeout = null;
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

// Inisialisasi Jaringan WebSocket
function initNetwork() {
  try {
    socket = new WebSocket(WS_SERVER_URL);

    socket.onopen = () => {
      statusBar.innerText = "Terkoneksi ke Server Meja Cloudflare";
    };

    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "TURN_UPDATE") {
          // Hanya jalankan jika giliran benar-benar berubah
          if (msg.seat !== currentTurnSeat) {
            applyTurnState(msg.seat);
          }
        } else if (msg.type === "DISCARD") {
          // Hindari duplikasi render buangan sendiri dari pantulan socket
          if (msg.seat !== 0) {
            addDiscardTile(msg.tile);
            checkPossibleActions(msg.tile);
          }
        }
      } catch (e) {}
    };

    socket.onerror = () => {
      statusBar.innerText = "Mode Offline (Rotasi Giliran Lokal)";
    };
  } catch (err) {
    statusBar.innerText = "Mode Offline (Rotasi Giliran Lokal)";
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
      handleTimeout();
    }
  }, 1000);
}

// Eksekusi Perpindahan Giliran
function applyTurnState(seatIndex) {
  currentTurnSeat = seatIndex;

  // Bersihkan timeout bot sebelumnya agar tidak menumpuk
  if (botActionTimeout) {
    clearTimeout(botActionTimeout);
    botActionTimeout = null;
  }

  // Update visual sorotan kursi
  seats.forEach((seatEl, idx) => {
    if (idx === seatIndex) {
      seatEl.classList.add("active-turn");
    } else {
      seatEl.classList.remove("active-turn");
    }
  });

  startTurnTimer();

  if (currentTurnSeat === 0) {
    statusBar.innerText = "Giliran Anda: Silakan buang 1 balok";
    drawTile();
  } else {
    statusBar.innerText = `Menunggu giliran Pemain ${currentTurnSeat + 1}...`;
    // Beri jeda wajar 2 detik untuk pemain bot/simulasi berpikir
    botActionTimeout = setTimeout(() => {
      simulateOpponentTurn(currentTurnSeat);
    }, 2000);
  }
}

function dispatchTurn(nextSeat) {
  // Update lokal
  applyTurnState(nextSeat);

  // Broadcast ke jaringan
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: "TURN_UPDATE",
      seat: nextSeat
    }));
  }
}

function handleTimeout() {
  if (currentTurnSeat === 0) {
    discardTile(myHand.length - 1);
  } else {
    dispatchTurn((currentTurnSeat + 1) % 4);
  }
}

function simulateOpponentTurn(seatIndex) {
  if (wallDeck.length === 0) {
    statusBar.innerText = "Game Selesai: Balok Habis (Draw)";
    clearInterval(turnTimerInterval);
    return;
  }

  // Ambil dan buang balok lawan
  const discarded = wallDeck.pop();
  lastDiscardedTile = discarded;
  addDiscardTile(discarded);
  checkPossibleActions(discarded);

  // Berikan jeda 1.2 detik setelah membuang kartu sebelum pindah giliran
  botActionTimeout = setTimeout(() => {
    const nextSeat = (seatIndex + 1) % 4;
    dispatchTurn(nextSeat);
  }, 1200);
}

// Render Balok Tangan
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
      seat: 0
    }));
  }

  // Pindah ke Pemain 2 (Kanan / Seat 1)
  dispatchTurn(1);
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
    dispatchTurn(0);
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
  dispatchTurn(0);
}

startNewGame();
