// Konfigurasi Server WebSocket (bisa diganti URL Cloudflare Worker Anda)
const WS_SERVER_URL = "wss://echo.websocket.events";

// Elemen Antarmuka (DOM)
const statusBar = document.getElementById("status-bar");
const handContainer = document.getElementById("player-hand");
const discardContainer = document.getElementById("discard-tiles");
const btnChow = document.getElementById("btn-chow") || document.querySelector("button[onclick*='CHOW']");
const btnPung = document.getElementById("btn-pung") || document.querySelector("button[onclick*='PUNG']");
const btnKong = document.getElementById("btn-kong") || document.querySelector("button[onclick*='KONG']");
const btnHu = document.getElementById("btn-win") || document.querySelector("button[onclick*='HU']");

// State Permainan
let socket = null;
let wallDeck = [];
let myHand = [];
let lastDiscardedTile = null;

// Daftar Balok Mahjong Standar (Total 136 Balok)
const SUITS = [
  { name: "Wan", symbol: "🀇", count: 9 }, // Karakter
  { name: "Pin", symbol: "🀙", count: 9 }, // Lingkaran
  { name: "Sou", symbol: "🀐", count: 9 }  // Bambu
];
const HONORS = [
  { name: "Dong", symbol: "🀀" }, // Timur
  { name: "Nan", symbol: "🀁" },  // Selatan
  { name: "Xi", symbol: "🀂" },   // Barat
  { name: "Bei", symbol: "🀃" },  // Utara
  { name: "Zhong", symbol: "🀄" },// Merah
  { name: "Fa", symbol: "🀅" },   // Hijau
  { name: "Bai", symbol: "🀆" }   // Putih
];

// 1. Fungsi Membuat dan Mengocok Tumpukan Balok
function createFullDeck() {
  const deck = [];

  // 3 Suit x 9 Angka x 4 Duplikat = 108 balok
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

  // 7 Honor Tiles x 4 Duplikat = 28 balok
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

// 2. Logika Koneksi Real-time WebSocket
function initNetwork() {
  try {
    socket = new WebSocket(WS_SERVER_URL);

    socket.onopen = () => {
      statusBar.innerText = "Terkoneksi ke Server. Game siap dimainkan!";
    };

    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "DISCARD") {
          addDiscardTile(msg.tile);
          checkPossibleActions(msg.tile);
        }
      } catch (e) {
        // Fallback jika menerima teks biasa non-JSON
      }
    };

    socket.onerror = () => {
      statusBar.innerText = "Mode Offline (Visual & Logika Lokal Aktif)";
    };
  } catch (err) {
    statusBar.innerText = "Mode Offline (Visual & Logika Lokal Aktif)";
  }
}

// 3. Render Visual Balok di Tangan
function renderHand() {
  handContainer.innerHTML = "";
  myHand.forEach((tile, index) => {
    const tileElement = document.createElement("div");
    tileElement.className = "tile";
    tileElement.innerText = tile.display;
    tileElement.onclick = () => discardTile(index);
    handContainer.appendChild(tileElement);
  });
}

// 4. Aksi Menarik Balok (Draw)
function drawTile() {
  if (wallDeck.length === 0) {
    statusBar.innerText = "Game Selesai: Tumpukan balok habis (Draw)!";
    return;
  }

  const newTile = wallDeck.pop();
  myHand.push(newTile);
  renderHand();
  statusBar.innerText = `Giliran Anda. Pilih 1 balok untuk dibuang (Sisa balok meja: ${wallDeck.length})`;
}

// 5. Aksi Membuang Balok (Discard)
function discardTile(index) {
  const discarded = myHand.splice(index, 1)[0];
  lastDiscardedTile = discarded;

  renderHand();
  addDiscardTile(discarded);
  hideActionButtons();

  // Kirim data ke WebSocket
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: "DISCARD",
      tile: discarded
    }));
  }

  // Simulasi giliran berikutnya: tarik kartu baru otomatis setelah 1 detik
  setTimeout(() => {
    drawTile();
  }, 1000);
}

// 6. Tampilkan Balok di Area Buangan Meja
function addDiscardTile(tile) {
  const tileElement = document.createElement("div");
  tileElement.className = "tile discarded";
  tileElement.innerText = tile.display || tile;
  discardContainer.appendChild(tileElement);
}

// 7. Deteksi Aksi Khusus (Pung Checker)
function checkPossibleActions(discardedTile) {
  const countSame = myHand.filter(t => t.display === discardedTile.display).length;

  if (countSame >= 2 && btnPung) {
    btnPung.style.display = "inline-block";
    btnPung.style.backgroundColor = "#27ae60"; // Hijau penanda aksi siap
  }
}

function hideActionButtons() {
  if (btnPung) {
    btnPung.style.backgroundColor = "";
  }
}

// 8. Handler Tombol Aksi Permainan
function claimAction(actionName) {
  if (actionName === "PUNG" && lastDiscardedTile) {
    // Ambil 2 balok kembar dari tangan
    let removed = 0;
    myHand = myHand.filter(tile => {
      if (tile.display === lastDiscardedTile.display && removed < 2) {
        removed++;
        return false;
      }
      return true;
    });

    renderHand();
    alert(`Berhasil PUNG untuk balok ${lastDiscardedTile.display}!`);
    hideActionButtons();
  } else {
    alert(`Aksi ${actionName} dipilih`);
  }

  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: "ACTION",
      action: actionName
    }));
  }
}

// Inisialisasi Game Baru
function startNewGame() {
  wallDeck = createFullDeck();
  myHand = wallDeck.splice(0, 13); // Ambil 13 balok awal
  renderHand();
  drawTile(); // Ambil balok ke-14 untuk memulai putaran pertama
  initNetwork();
}

// Jalankan saat script dimuat
startNewGame();
