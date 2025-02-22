document.addEventListener("DOMContentLoaded", () => {
  // ------------------------------
  // Global Variables & Card Data
  // ------------------------------
  const cardDeck = [
    { name: "Teleportation", effect: "moveAnyPieceAnywhere" },
    { name: "Shield", effect: "protectPiece" },
    { name: "Knight's Leap", effect: "moveLikeKnight" },
    { name: "Swap Sacrifice", effect: "swapPieces" }
  ];

  const playerHand = {
    white: [],
    black: []
  };

  // Determine player's color (persisted in localStorage)
  let myColor = localStorage.getItem("myColor");
  if (!myColor) {
    myColor = prompt("Choose your color (white/black):", "white").toLowerCase();
    if (myColor !== "white" && myColor !== "black") myColor = "white";
    localStorage.setItem("myColor", myColor);
  }

  // ------------------------------
  // Socket.IO Initialization
  // ------------------------------
  const socket = io("http://147.182.134.57:3000"); // Replace with your server's URL/IP

  // Global gameId variable (set after join)
  let gameId = null;

  // ------------------------------
  // Join Button Handling for Auto-Match
  // ------------------------------
  const joinButton = document.getElementById("join-button");
  joinButton.addEventListener("click", () => {
    // Call the /match endpoint to auto-match players.
    fetch("http://147.182.134.57:3000/match")
      .then(response => response.json())
      .then(gameDoc => {
        gameId = gameDoc._id;
        localStorage.setItem("gameId", gameId);
        // Display the room name at the top (if available)
        const roomNameEl = document.getElementById("room-name");
        if (roomNameEl) {
          roomNameEl.textContent = "Room: " + (gameDoc.gameCode || "AutoMatch");
        }
        loadGame();
        joinButton.style.display = "none"; // Hide join button
      })
      .catch(err => console.error("Error matching game:", err));
  });

  // ------------------------------
  // Load Game State & Join Room
  // ------------------------------
  function loadGame() {
    fetch(`http://147.182.134.57:3000/game/${gameId}`)
      .then(response => response.json())
      .then(data => {
        // Set board state
        game.board.position(data.boardState);
        // Set current player's hand
        playerHand[myColor] = data.playerHands[myColor] || [];
        game.updateCardDisplay();
      })
      .catch(err => console.error("Error loading game:", err));

    // Join the socket room
    socket.emit("join-game", gameId);
  }

  function sendMove(fen) {
    socket.emit("move-piece", { gameId, fen });
  }

  socket.on("update-board", (fen) => {
    game.chess.load(fen);
    game.board.position(fen);
    game.updateStatus();
    
    // Clear any card modes when receiving opponent's move
    if (game.chess.turn() === (myColor === 'white' ? 'b' : 'w')) {
      game.resetCardMode();
    }
  });

  socket.on("error", (message) => {
    console.error("Socket error:", message);
    game.showMessage(message);
  });

  socket.on("match-start", (data) => {
    game.waitingForOpponent = false;
    game.showMessage(data.message);
    // Ensure gameId is set
    if (data.gameId && !gameId) {
      gameId = data.gameId;
    }
  });

  // ------------------------------
  // Game Object (Client-Side)
  // ------------------------------
  const game = {
    chess: new Chess(),
    board: null,
    players: {
      white: { name: "White", tokens: 3 },
      black: { name: "Black", tokens: 3 }
    },
    protectedPiece: null,
    shieldActiveForPlayer: null,
    cardMode: null,
    cardPlayer: null,
    selectedPiece: null,
    swapFirstPiece: null,
    previousTurn: null,
    cardPlayedThisTurn: false,
    isSkippingTurn: false,
    waitingForOpponent: true, // Initially disable moves until match starts
    newlyDrawnCards: {
      white: new Set(),
      black: new Set()
    },

    init() {
      console.log("Initializing chessboard...");
      this.board = Chessboard("board", {
        draggable: true,
        position: "start",
        pieceTheme: "img/chesspieces/custom/{piece}.png",
        orientation: myColor,
        onDragStart: this.onDragStart.bind(this),
        onDrop: this.onDrop.bind(this),
        onMouseoverSquare: this.onMouseoverSquare.bind(this),
        onMouseoutSquare: this.onMouseoutSquare.bind(this)
      });
      console.log("Chessboard initialized.");
      this.updateStatus();
      this.updateTokens();
      this.updateCardDisplay();

      // Hide opponent's cards; show only current player's hand
      if (myColor === "white") {
        document.getElementById("black-hand").style.display = "none";
        document.getElementById("white-hand").style.display = "block";
      } else {
        document.getElementById("white-hand").style.display = "none";
        document.getElementById("black-hand").style.display = "block";
      }

      // Add click listeners for card actions on board squares
      const squares = document.querySelectorAll(".square-55d63");
      squares.forEach((square) => {
        square.addEventListener("click", (e) => {
          if (this.cardMode === "teleport") {
            this.handleTeleportClick(e);
          } else if (this.cardMode === "shield") {
            this.handleShieldClick(this.cardPlayer, e);
          } else if (this.cardMode === "knight") {
            this.handleKnightsLeapClick(this.cardPlayer, e);
          } else if (this.cardMode === "swap") {
            this.handleSwapClick(e);
          }
        });
      });

      // Add skip turn button
      const skipTurnBtn = document.createElement("button");
      skipTurnBtn.id = "skip-turn-btn";
      skipTurnBtn.className = "help-button";
      skipTurnBtn.textContent = "Skip Turn (Draw Card)";
      skipTurnBtn.onclick = () => {
        const currentPlayer = this.chess.turn() === "w" ? "white" : "black";
        if (!this.cardPlayedThisTurn) {
          this.skipTurn(currentPlayer);
        } else {
          this.showMessage("You can't skip your turn after playing a card!");
        }
      };
      document.querySelector(".container").appendChild(skipTurnBtn);

      // Initialize help section
      const helpButton = document.createElement("button");
      helpButton.id = "toggle-help";
      helpButton.className = "help-button";
      helpButton.textContent = "Show Game Rules";
      helpButton.onclick = () => this.toggleCardHelp();

      const helpSection = document.createElement("div");
      helpSection.id = "card-help";
      helpSection.className = "hidden";
      helpSection.innerHTML = `
          <div class="help-section">
              <h3>Card Effects</h3>
              <ul>
                  <li><strong>Teleportation:</strong> Move any piece to an empty square. Ends your turn.</li>
                  <li><strong>Shield:</strong> Protect one piece from capture until your next turn.</li>
                  <li><strong>Knight's Leap:</strong> Move a piece like a knight (L-shape). Can capture pieces. Ends your turn.</li>
                  <li><strong>Swap Sacrifice:</strong> Swap positions of two pieces. Ends your turn.</li>
              </ul>
          </div>
          <div class="help-section">
              <h3>How to Draw Cards</h3>
              <p>You can draw a card (up to 3 max) by performing any of these actions:</p>
              <ul>
                  <li>Putting opponent's king in check</li>
                  <li>Promoting a pawn</li>
                  <li>Castling</li>
                  <li>Capturing a piece</li>
                  <li>Defending a threatened piece</li>
                  <li>Creating a fork</li>
                  <li>Pinning an opponent's piece</li>
                  <li>Skipping your turn</li>
              </ul>
              <p><em>You can hold up to 3 cards at a time.</em></p>
          </div>
      `;
      const helpContainer = document.createElement("div");
      helpContainer.id = "card-help-container";
      helpContainer.appendChild(helpButton);
      helpContainer.appendChild(helpSection);
      document.querySelector(".container").appendChild(helpContainer);
    },

    onDragStart(source, piece) {
      if (this.cardMode) return false;
      if (this.chess.game_over()) return false;
      
      // Check if it's this player's turn
      const currentTurn = this.chess.turn() === 'w' ? 'white' : 'black';
      if (currentTurn !== myColor) {
        this.showMessage("Not your turn!");
        return false;
      }

      // Check if piece belongs to the player
      if ((myColor === 'white' && piece.search(/^b/) !== -1) ||
          (myColor === 'black' && piece.search(/^w/) !== -1)) {
        this.showMessage("Can't move opponent's pieces!");
        return false;
      }

      // Check if waiting for opponent
      if (this.waitingForOpponent) {
        this.showMessage("Waiting for opponent to join...");
        return false;
      }

      return true;
    },

    onDrop(source, target) {
      if (this.cardMode) return;
      const move = this.chess.move({ from: source, to: target, promotion: "q" });
      if (!move) return "snapback";
      const currentPlayer = this.chess.turn() === "w" ? "black" : "white";
      const opponent = currentPlayer === "white" ? "black" : "white";
      if (move.captured && this.protectedPiece === target && this.shieldActiveForPlayer === opponent) {
        this.chess.undo();
        console.log(`Move blocked: ${opponent}'s piece at ${target} is shielded!`);
        return "snapback";
      }
      this.drawCard(currentPlayer);
      if (move.captured) {
        this.drawCard(currentPlayer);
        document.getElementById("capture-sound").play();
      } else {
        document.getElementById("move-sound").play();
      }
      this.board.position(this.chess.fen());
      this.updateStatus();
      this.updateCardDisplay();
      if (move !== null) {
        const nextPlayer = this.chess.turn() === "w" ? "white" : "black";
        this.clearNewlyDrawnCards(nextPlayer);
      }
      sendMove(this.chess.fen());
    },

    drawCard(player) {
      if (cardDeck.length === 0) return;
      const lastMove = this.chess.history({ verbose: true }).pop();
      if (!lastMove && !this.isSkippingTurn) return;
      let shouldDrawCard = false;
      const reasons = [];
      if (this.isSkippingTurn) {
        shouldDrawCard = true;
        reasons.push("skipping turn");
        this.isSkippingTurn = false;
      } else if (lastMove) {
        if (this.chess.in_check()) {
          shouldDrawCard = true;
          reasons.push("putting opponent in check");
        }
        if (lastMove.flags.includes("p")) {
          shouldDrawCard = true;
          reasons.push("promoting a pawn");
        }
        if (lastMove.flags.includes("k") || lastMove.flags.includes("q")) {
          shouldDrawCard = true;
          reasons.push("castling");
        }
        if (lastMove.captured) {
          shouldDrawCard = true;
          reasons.push("capturing a piece");
        }
        if (this.isDefendingMove(lastMove)) {
          shouldDrawCard = true;
          reasons.push("defending a threatened piece");
        }
        if (this.isForking(lastMove)) {
          shouldDrawCard = true;
          reasons.push("creating a fork");
        }
        if (this.isPinning(lastMove)) {
          shouldDrawCard = true;
          reasons.push("pinning an opponent's piece");
        }
      }
      if (shouldDrawCard && playerHand[player].length < 3) {
        const randomIndex = Math.floor(Math.random() * cardDeck.length);
        const card = cardDeck[randomIndex];
        const cardIndex = playerHand[player].length;
        playerHand[player].push(card);
        this.newlyDrawnCards[player].add(cardIndex);
        this.showMessage(`${player} drew ${card.name} for ${reasons.join(" and ")}. Card can be used next turn.`);
        this.updateCardDisplay();
      }
    },

    playCard(player, cardIndex) {
      if (this.cardPlayedThisTurn) {
        this.showMessage("You can only play one card per turn!");
        return;
      }
      if (this.cardMode) {
        this.showMessage(`Clearing previous card mode: ${this.cardMode}`);
        this.resetCardMode();
      }
      this.pendingCard = { player, cardIndex };
      const card = playerHand[player][cardIndex];
      this.cardPlayer = player;
      const currentTurn = this.chess.turn() === "w" ? "white" : "black";
      if (player !== currentTurn) {
        this.showMessage(`You can only play cards during your turn! Current turn: ${currentTurn}`);
        return;
      }
      if (this.newlyDrawnCards[player].has(cardIndex)) {
        this.showMessage("Newly drawn cards can't be used until your next turn!");
        return;
      }
      switch (card.effect) {
        case "moveAnyPieceAnywhere":
          this.showMessage(`${player}'s turn: Teleportation activated! Click a piece to teleport, then a destination.`);
          this.enableTeleportation(player);
          break;
        case "moveLikeKnight":
          this.showMessage(`${player}'s turn: Knight's Leap activated! Click a piece to move like a knight, then a destination.`);
          this.enableKnightsLeap(player);
          break;
        case "protectPiece":
          this.showMessage(`${player}'s turn: Shield activated! Click a piece to protect it.`);
          this.enableShield(player);
          break;
        case "swapPieces":
          this.showMessage(`${player}'s turn: Swap activated! Click first piece to swap, then the second piece.`);
          this.enableSwap(player);
          break;
        default:
          this.showMessage(`Card effect ${card.effect} not implemented.`);
          this.pendingCard = null;
          return;
      }
      if (this.cardMode) {
        document.getElementById("cancel-card-action").style.display = "block";
      }
    },

    cancelCardAction() {
      this.resetCardMode();
      this.showMessage("Card action canceled. You can choose another card or make a normal move.");
    },

    enableTeleportation(player) {
      this.cardMode = "teleport";
      this.selectedPiece = null;
      this.highlightPlayerPieces(player);
    },

    showMessage(message) {
      console.log(message);
      const messageLog = document.getElementById("message-log");
      const messageElement = document.createElement("p");
      messageElement.textContent = message;
      if (messageLog.firstChild) {
        messageLog.insertBefore(messageElement, messageLog.firstChild);
      } else {
        messageLog.appendChild(messageElement);
      }
      const maxMessages = 5;
      while (messageLog.children.length > maxMessages) {
        messageLog.removeChild(messageLog.lastChild);
      }
    },

    handleTeleportClick(event) {
      if (this.chess.turn() === 'w' ? 'white' : 'black' !== myColor) {
        this.showMessage("Not your turn!");
        return;
      }
      
      const square = event.target.closest(".square-55d63");
      if (!square) return;
      const position = square.dataset.square;
      if (!position) return;

      if (!this.selectedPiece) {
        const piece = this.chess.get(position);
        if (piece && piece.color === (myColor === "white" ? "w" : "b")) {
          this.selectedPiece = position;
          this.highlightEmptySquares();
          this.showMessage(`Selected ${piece.type} at ${position}. Now click an empty square for destination.`);
        } else {
          this.showMessage("You can only teleport your own pieces!");
        }
      } else {
        const success = this.teleportPiece(this.cardPlayer, this.selectedPiece, position);
        if (success) {
          playerHand[this.pendingCard.player].splice(this.pendingCard.cardIndex, 1);
          this.updateCardDisplay();
          this.cardPlayedThisTurn = true;
          this.resetCardMode();
          const nextPlayer = this.cardPlayer === "white" ? "black" : "white";
          const newFen = this.chess.fen().replace(/ w | b /, ` ${nextPlayer === "white" ? "w" : "b"} `);
          this.chess.load(newFen);
          this.board.position(this.chess.fen());
          this.updateStatus();
          this.lockBoard();
          this.showMessage(`${this.cardPlayer}'s teleport complete. ${nextPlayer}'s turn.`);
          sendMove(this.chess.fen());
        }
      }
    },

    teleportPiece(player, source, target) {
      const piece = this.chess.get(source);
      if (!piece) return false;
      const targetPiece = this.chess.get(target);
      if (targetPiece) {
        this.showMessage("Can only teleport to empty squares!");
        return false;
      }
      this.chess.remove(source);
      this.chess.put(piece, target);
      if (this.chess.in_check()) {
        this.chess.remove(target);
        this.chess.put(piece, source);
        console.log("Invalid teleportation: cannot leave king in check.");
        return false;
      } else {
        document.getElementById("move-sound").play();
        console.log(`${player} teleported ${piece.type} from ${source} to ${target}. Turn ends.`);
        sendMove(this.chess.fen());
        return true;
      }
    },

    enableShield(player) {
      this.cardMode = "shield";
      this.selectedPiece = null;
      this.highlightPlayerPieces(player);
    },

    handleShieldClick(player, event) {
      if (player !== myColor) {
        this.showMessage("Not your turn!");
        return;
      }
      
      const square = event.target.closest(".square-55d63");
      if (!square) return;
      const position = square.dataset.square;
      const piece = this.chess.get(position);
      if (piece && piece.color === (myColor === "white" ? "w" : "b")) {
        this.applyShield(player, position);
      } else {
        this.showMessage("You can only shield your own pieces!");
      }
    },

    enableKnightsLeap(player) {
      this.cardMode = "knight";
      this.selectedPiece = null;
      this.highlightPlayerPieces(player);
    },

    handleKnightsLeapClick(player, event) {
      if (player !== myColor) {
        this.showMessage("Not your turn!");
        return;
      }
      
      const square = event.target.closest(".square-55d63");
      if (!square) return;
      const position = square.dataset.square;
      if (!this.selectedPiece) {
        const piece = this.chess.get(position);
        if (piece && piece.color === (myColor === "white" ? "w" : "b")) {
          this.selectedPiece = position;
          this.highlightKnightMoves(position);
          this.showMessage(`Selected ${piece.type} at ${position}. Now click a knight-move destination.`);
        } else {
          this.showMessage("You can only move your own pieces!");
        }
      } else {
        if (this.isKnightMove(this.selectedPiece, position)) {
          const success = this.moveLikeKnight(player, this.selectedPiece, position);
          if (success) {
            playerHand[this.pendingCard.player].splice(this.pendingCard.cardIndex, 1);
            this.updateCardDisplay();
            this.cardPlayedThisTurn = true;
            this.resetCardMode();
            const nextPlayer = player === "white" ? "black" : "white";
            const newFen = this.chess.fen().replace(/ w | b /, ` ${nextPlayer === "white" ? "w" : "b"} `);
            this.chess.load(newFen);
            this.board.position(this.chess.fen());
            this.updateStatus();
            this.lockBoard();
            this.showMessage(`${player}'s Knight's Leap complete. ${nextPlayer}'s turn.`);
            sendMove(this.chess.fen());
          }
        } else {
          this.showMessage(`${player} tried an invalid knight move to ${position}. Select a valid knight-move square.`);
          this.highlightKnightMoves(this.selectedPiece);
        }
      }
    },

    moveLikeKnight(player, source, target) {
      const piece = this.chess.get(source);
      if (!piece) return false;
      const targetPiece = this.chess.get(target);
      const opponent = player === "white" ? "black" : "white";
      if (targetPiece && this.protectedPiece === target && this.shieldActiveForPlayer === opponent) {
        this.showMessage(`Knight's Leap blocked: ${opponent}'s piece at ${target} is shielded!`);
        return false;
      }
      const originalTargetPiece = targetPiece;
      this.chess.remove(source);
      this.chess.put(piece, target);
      if (this.chess.in_check()) {
        this.chess.remove(target);
        if (originalTargetPiece) this.chess.put(originalTargetPiece, target);
        this.chess.put(piece, source);
        this.showMessage("Invalid knight's leap: cannot leave king in check.");
        return false;
      } else {
        if (originalTargetPiece && originalTargetPiece.color !== piece.color) {
          this.showMessage(`${player} captured ${originalTargetPiece.type} at ${target} with Knight's Leap!`);
          document.getElementById("capture-sound").play();
        } else {
          document.getElementById("move-sound").play();
        }
        const nextPlayer = player === "white" ? "black" : "white";
        const newFen = this.chess.fen().replace(/ w | b /, ` ${nextPlayer === "white" ? "w" : "b"} `);
        this.chess.load(newFen);
        this.showMessage(`${player} moved ${piece.type} like a knight from ${source} to ${target}. ${nextPlayer}'s turn.`);
        sendMove(this.chess.fen());
        return true;
      }
    },

    enableSwap(player) {
      this.cardMode = "swap";
      this.selectedPiece = null;
      this.swapFirstPiece = null;
      this.highlightPlayerPieces(player);
    },

    handleSwapClick(event) {
      if (this.chess.turn() === 'w' ? 'white' : 'black' !== myColor) {
        this.showMessage("Not your turn!");
        return;
      }
      
      const square = event.target.closest(".square-55d63");
      if (!square) return;
      const position = square.dataset.square;
      if (!this.swapFirstPiece) {
        const piece = this.chess.get(position);
        if (piece && piece.color === (myColor === "white" ? "w" : "b")) {
          this.swapFirstPiece = position;
          this.highlightPlayerPieces(myColor);
          this.showMessage(`Selected ${piece.type} at ${position}. Now click the second piece to swap.`);
        } else {
          this.showMessage("You can only swap your own pieces!");
        }
      } else {
        const success = this.swapPieces(this.cardPlayer, this.swapFirstPiece, position);
        if (success) {
          playerHand[this.pendingCard.player].splice(this.pendingCard.cardIndex, 1);
          this.updateCardDisplay();
          this.cardPlayedThisTurn = true;
          this.resetCardMode();
          const nextPlayer = this.cardPlayer === "white" ? "black" : "white";
          const newFen = this.chess.fen().replace(/ w | b /, ` ${nextPlayer === "white" ? "w" : "b"} `);
          this.chess.load(newFen);
          this.board.position(this.chess.fen());
          this.updateStatus();
          this.lockBoard();
          this.showMessage(`${this.cardPlayer}'s swap complete. ${nextPlayer}'s turn.`);
          sendMove(this.chess.fen());
        }
      }
    },

    swapPieces(player, source, target) {
      const piece1 = this.chess.get(source);
      const piece2 = this.chess.get(target);
      if (piece1 && piece2 && piece1.color === piece2.color) {
        const originalPiece1 = piece1;
        const originalPiece2 = piece2;
        this.chess.remove(source);
        this.chess.remove(target);
        this.chess.put(originalPiece1, target);
        this.chess.put(originalPiece2, source);
        if (this.chess.in_check()) {
          this.chess.remove(source);
          this.chess.remove(target);
          this.chess.put(originalPiece1, source);
          this.chess.put(originalPiece2, target);
          this.showMessage("Cannot swap pieces: would leave king in check!");
          return false;
        }
        this.board.position(this.chess.fen());
        document.getElementById("move-sound").play();
        const nextPlayer = player === "white" ? "black" : "white";
        const newFen = this.chess.fen().replace(/ w | b /, ` ${nextPlayer === "white" ? "w" : "b"} `);
        this.chess.load(newFen);
        this.showMessage(`${player} swapped ${piece1.type} at ${source} with ${piece2.type} at ${target}. ${nextPlayer}'s turn.`);
        sendMove(this.chess.fen());
        return true;
      } else {
        this.showMessage("Can only swap pieces of the same color!");
        this.swapFirstPiece = null;
        this.highlightPlayerPieces(player);
        return false;
      }
    },

    applyShield(player, square) {
      const piece = this.chess.get(square);
      if (piece && piece.color === (player === "white" ? "w" : "b")) {
        if (this.protectedPiece) {
          const oldSquare = document.querySelector(`.square-${this.protectedPiece}`);
          if (oldSquare) {
            oldSquare.classList.remove("shield-active");
          }
        }
        this.protectedPiece = square;
        this.shieldActiveForPlayer = player;
        const squareElement = document.querySelector(`.square-${square}`);
        if (squareElement) {
          squareElement.classList.add("shield-active");
          squareElement.classList.add("shield-animation");
          setTimeout(() => {
            squareElement.classList.remove("shield-animation");
          }, 1000);
        }
        this.showMessage(`${player} protected piece at ${square} until their next turn begins.`);
        playerHand[this.pendingCard.player].splice(this.pendingCard.cardIndex, 1);
        this.updateCardDisplay();
        this.cardPlayedThisTurn = true;
        this.resetCardMode();
        this.board.position(this.chess.fen());
        this.updateStatus();
      }
    },

    isKnightMove(source, target) {
      const sourceX = source.charCodeAt(0) - "a".charCodeAt(0);
      const sourceY = parseInt(source[1]) - 1;
      const targetX = target.charCodeAt(0) - "a".charCodeAt(0);
      const targetY = parseInt(target[1]) - 1;
      const dx = Math.abs(targetX - sourceX);
      const dy = Math.abs(targetY - sourceY);
      return (dx === 2 && dy === 1) || (dx === 1 && dy === 2);
    },

    advanceTurn() {
      const currentTurn = this.chess.turn();
      this.chess.load(this.chess.fen(), true);
      this.chess.load(`${this.chess.fen().split(" ")[0]} ${currentTurn === "w" ? "b" : "w"} ${this.chess.fen().split(" ")[2]} ${this.chess.fen().split(" ")[3]} ${this.chess.fen().split(" ")[4]} ${parseInt(this.chess.fen().split(" ")[5]) + 1}`, true);
    },

    lockBoard() {
      this.board.draggable = false;
      setTimeout(() => {
        this.board.draggable = true;
      }, 100);
    },

    highlightPlayerPieces(player) {
      const squares = document.querySelectorAll(".square-55d63");
      squares.forEach(square => {
        const piece = this.chess.get(square.dataset.square);
        if (piece && piece.color === (player === "white" ? "w" : "b")) {
          square.classList.add("highlight");
        } else {
          square.classList.remove("highlight");
        }
      });
    },

    highlightAllSquares() {
      const squares = document.querySelectorAll(".square-55d63");
      squares.forEach(square => square.classList.add("highlight"));
    },

    highlightKnightMoves(source) {
      const sourceX = source.charCodeAt(0) - "a".charCodeAt(0);
      const sourceY = parseInt(source[1]) - 1;
      const knightMoves = [
        [2, 1], [2, -1], [-2, 1], [-2, -1],
        [1, 2], [1, -2], [-1, 2], [-1, -2]
      ];
      const squares = document.querySelectorAll(".square-55d63");
      squares.forEach(square => square.classList.remove("highlight"));
      knightMoves.forEach(([dx, dy]) => {
        const targetX = sourceX + dx;
        const targetY = sourceY + dy;
        if (targetX >= 0 && targetX < 8 && targetY >= 0 && targetY < 8) {
          const targetSquare = String.fromCharCode("a".charCodeAt(0) + targetX) + (targetY + 1);
          const squareElement = document.querySelector(`.square-${targetSquare}`);
          if (squareElement) {
            squareElement.classList.add("highlight");
          }
        }
      });
    },

    resetCardMode() {
      this.cardMode = null;
      this.cardPlayer = null;
      this.selectedPiece = null;
      this.pendingCard = null;
      const squares = document.querySelectorAll(".square-55d63");
      squares.forEach(square => {
        square.classList.remove("highlight");
      });
      this.board.draggable = true;
      document.getElementById("cancel-card-action").style.display = "none";
    },

    onMouseoverSquare(square, piece) {
      if (this.cardMode === "shield" && piece) {
        document.querySelector(`.square-${square}`).classList.add("highlight");
      }
    },

    onMouseoutSquare(square, piece) {
      if (this.cardMode === "shield" && this.protectedPiece !== square) {
        document.querySelector(`.square-${square}`).classList.remove("highlight");
      }
    },

    updateStatus() {
      let status = "";
      if (this.chess.in_checkmate()) {
        status = `Checkmate! ${this.chess.turn() === "w" ? "Black" : "White"} wins!`;
        this.showMessage(status);
      } else if (this.chess.in_stalemate()) {
        status = "Stalemate! Draw!";
        this.showMessage(status);
      } else {
        const turn = this.chess.turn() === "w" ? "White" : "Black";
        status = `${turn}'s turn${this.chess.in_check() ? " - Check!" : ""}`;
        if (this.chess.in_check()) {
          this.showMessage(`${turn} is in check!`);
        }
      }
      document.getElementById("status").textContent = status;
      const currentTurn = this.chess.turn() === "w" ? "white" : "black";
      if (this.previousTurn !== currentTurn) {
        this.cardPlayedThisTurn = false;
        if (this.shieldActiveForPlayer && this.shieldActiveForPlayer === currentTurn) {
          const squareElement = document.querySelector(`.square-${this.protectedPiece}`);
          if (squareElement) {
            squareElement.classList.remove("shield-active");
          }
          this.showMessage(`Shield deactivated for ${this.shieldActiveForPlayer} as their turn begins.`);
          this.protectedPiece = null;
          this.shieldActiveForPlayer = null;
        }
      }
      this.previousTurn = currentTurn;
    },

    updateTokens() {
      document.getElementById("white-tokens").textContent = `White: ${this.players.white.tokens} tokens`;
      document.getElementById("black-tokens").textContent = `Black: ${this.players.black.tokens} tokens`;
    },

    updateCardDisplay() {
      if (myColor === "white") {
        document.getElementById("white-hand").style.display = "block";
        document.getElementById("black-hand").style.display = "none";
      } else {
        document.getElementById("black-hand").style.display = "block";
        document.getElementById("white-hand").style.display = "none";
      }
      const handElement = myColor === "white" ? document.getElementById("white-hand") : document.getElementById("black-hand");
      handElement.innerHTML = "";
      playerHand[myColor].forEach((card, index) => {
        const button = document.createElement("button");
        button.textContent = card.name;
        button.onclick = () => this.playCard(myColor, index);
        const currentTurn = this.chess.turn() === "w" ? "white" : "black";
        button.disabled = currentTurn !== myColor || this.newlyDrawnCards[myColor].has(index);
        if (this.newlyDrawnCards[myColor].has(index)) {
          button.classList.add("newly-drawn");
          button.title = "Available next turn";
        }
        handElement.appendChild(button);
      });
    },

    completeCardAction() {
      if (this.pendingCard) {
        playerHand[this.pendingCard.player].splice(this.pendingCard.cardIndex, 1);
        this.updateCardDisplay();
        this.cardPlayedThisTurn = true;
        this.resetCardMode();
        this.advanceTurn();
        this.board.position(this.chess.fen());
        this.updateStatus();
        this.lockBoard();
        sendMove(this.chess.fen());
      }
    },

    highlightEmptySquares() {
      const squares = document.querySelectorAll(".square-55d63");
      squares.forEach(square => {
        const position = square.dataset.square;
        if (position && !this.chess.get(position)) {
          square.classList.add("highlight");
        } else {
          square.classList.remove("highlight");
        }
      });
    },

    isDefendingMove(move) {
      const fen = this.chess.fen();
      this.chess.undo();
      const threatenedBefore = this.getThreatenedPieces(move.color);
      this.chess.load(fen);
      const threatenedAfter = this.getThreatenedPieces(move.color);
      return threatenedAfter.length < threatenedBefore.length;
    },

    getThreatenedPieces(color) {
      const threatened = [];
      for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
          const square = String.fromCharCode("a".charCodeAt(0) + col) + (row + 1);
          const piece = this.chess.get(square);
          if (piece && piece.color === color) {
            if (this.isSquareAttacked(square, color === "w" ? "b" : "w")) {
              threatened.push(square);
            }
          }
        }
      }
      return threatened;
    },

    isSquareAttacked(square, byColor) {
      const moves = this.chess.moves({ verbose: true });
      return moves.some(move => 
        move.to === square && 
        this.chess.get(move.from)?.color === byColor
      );
    },

    isForking(move) {
      const moves = this.chess.moves({ square: move.to, verbose: true });
      const attackedPieces = moves.filter(m => this.chess.get(m.to)?.color !== this.chess.get(move.to)?.color);
      return attackedPieces.length >= 2;
    },

    isPinning(move) {
      const piece = this.chess.get(move.to);
      if (!piece) return false;
      const fen = this.chess.fen();
      this.chess.remove(move.to);
      const movesBefore = this.chess.moves().length;
      this.chess.load(fen);
      return this.chess.moves().length < movesBefore;
    },

    skipTurn(player) {
      this.isSkippingTurn = true;
      this.drawCard(player);
      const nextPlayer = player === "white" ? "black" : "white";
      this.chess.load(this.chess.fen().replace(/ w | b /, ` ${nextPlayer === "white" ? "w" : "b"} `));
      this.clearNewlyDrawnCards(nextPlayer);
      this.board.position(this.chess.fen());
      this.updateStatus();
      this.showMessage(`${player} skipped their turn and drew a card. ${nextPlayer}'s turn.`);
      sendMove(this.chess.fen());
    },

    toggleCardHelp() {
      const helpSection = document.getElementById("card-help");
      helpSection.className = helpSection.className === "hidden" ? "" : "hidden";
    },

    clearNewlyDrawnCards(player) {
      this.newlyDrawnCards[player].clear();
    },

    endCurrentTurn() {
      const currentPlayer = this.cardPlayer;
      const nextPlayer = currentPlayer === "white" ? "black" : "white";
      this.chess.load(this.chess.fen().replace(/ w | b /, ` ${nextPlayer === "white" ? "w" : "b"} `));
      this.clearNewlyDrawnCards(nextPlayer);
      this.board.position(this.chess.fen());
      playerHand[currentPlayer].splice(this.pendingCard.cardIndex, 1);
      this.updateCardDisplay();
      this.cardPlayedThisTurn = true;
      this.resetCardMode();
      const squares = document.querySelectorAll(".square-55d63");
      squares.forEach(sq => sq.classList.remove("highlight"));
      this.updateStatus();
      this.lockBoard();
      this.showMessage(`${nextPlayer}'s turn.`);
      sendMove(this.chess.fen());
    }
  };

  // ------------------------------
  // Initialize the Game Locally
  // ------------------------------
  game.init();

  // ------------------------------
  // Server-Side Integration (Client-Side)
  // ------------------------------
  let storedGameId = localStorage.getItem("gameId");
  if (storedGameId) {
    gameId = storedGameId;
    loadGame();
    socket.emit("join-game", gameId);
  } else {
    console.log("Waiting for user to join a match via the join button...");
  }

  function sendMove(fen) {
    socket.emit("move-piece", { gameId, fen });
  }

  socket.on("update-board", (fen) => {
    game.board.position(fen);
  });

  function updateHandDisplay(newHands) {
    playerHand[myColor] = newHands[myColor];
    game.updateCardDisplay();
  }
});
